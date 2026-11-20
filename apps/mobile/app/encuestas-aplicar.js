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
//
// Zonas de campo (2026-11-19): si la encuesta las tiene, se elige la zona en
// su tarjeta antes de entrevistar y vale para las siguientes del día. La base
// rechaza guardar sin zona.
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { AppState, LayoutAnimation, Linking, ScrollView, Text, View } from 'react-native';
import { Presionable as Pressable } from '../componentes/Tocable';
import Refrescar from '../componentes/Refrescar';
import { Stack } from 'expo-router';
import * as WebBrowser from 'expo-web-browser';
import { fetchParaAplicar, fetchLugaresDeCampo, guardarEntrevista, guardarEntrevistaCampo, marcarMuestraEntregada } from '@nucleo/data/encuestasClientes';
import { salaDeHoy } from '@nucleo/data/puntos';
import { enlaceDeEncuesta, cuantasPreguntas, zonasDe, nombreDeZona, avanceDeZona } from '@nucleo/utils/encuestasClientes';
import { fechaTexto, hoySV } from '@nucleo/utils/fecha';
import { sugerenciasDeLugar, distanciaDeLugar } from '@nucleo/utils/lugaresDeCampo';
import { BARRA_NATIVA } from '../componentes/PilaDePestana';
import { colorSistema } from '../componentes/Formulario';
import { Aviso, BotonGrande, Campo, Opciones, Cargando, Vacio } from '../componentes/formulario/Piezas';
import { Pildora } from '../componentes/avisos/Piezas';
import Vidrio from '../componentes/Vidrio';
import { MARCA } from '../componentes/inicio/marca';
import { fallo, listo } from '../componentes/Progreso';
import { PORTAL_URL } from '../plataforma/config';
import { leer, guardar } from '../plataforma/almacen';
import { leerPosicion, ubicacionNegada } from '../plataforma/ubicacion';
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
  const [lugares, setLugares] = useState([]); // los lugares de campo ya usados por el equipo
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
    const d = v === CAMPO ? { campo: true, lugar: donde?.lugar || '', zonas: donde?.zonas || {} } : { sala: Number(v) };
    setDonde(d); guardarDonde(d); setEligiendo(false);
  };
  const escribirLugar = (lugar) => { const d = { campo: true, lugar, zonas: donde?.zonas || {} }; setDonde(d); guardarDonde(d); };
  // La zona elegida para cada encuesta (sólo si sigue existiendo en ella).
  const zonaDe = (e) => {
    const id = donde?.zonas?.[e.id];
    return zonasDe(e).some((z) => z.id === id) ? id : null;
  };
  const elegirZona = (encuestaId, zonaId) => {
    const d = { campo: true, lugar: donde?.lugar || '', zonas: { ...(donde?.zonas || {}), [encuestaId]: zonaId } };
    setDonde(d); guardarDonde(d);
  };

  // En campo el permiso de ubicación se pide al elegirlo, no en medio de la primera entrevista.
  const buscarUbicacion = useCallback(async () => {
    setGps('buscando');
    const p = await leerPosicion({ espera: 12000 });
    // Sin permiso no se encuesta en campo (usuario, 2026-11-20): cada
    // respuesta tiene que decir dónde se hizo.
    setGps(p || ((await ubicacionNegada()) ? 'negado' : 'sin'));
    return p;
  }, []);
  useEffect(() => { if (enCampo && gps === null) buscarUbicacion(); }, [enCampo, gps, buscarUbicacion]);
  // Al volver de Ajustes con el permiso dado, se lee de nuevo sin tocar nada.
  useEffect(() => {
    if (!enCampo || gps !== 'negado') return undefined;
    const sub = AppState.addEventListener('change', (estado) => { if (estado === 'active') buscarUbicacion(); });
    return () => sub.remove();
  }, [enCampo, gps, buscarUbicacion]);
  // Los lugares ya usados: si falla, no se sugiere nada y se escribe a mano.
  useEffect(() => {
    if (!enCampo) return;
    fetchLugaresDeCampo().then(setLugares).catch(() => setLugares([]));
  }, [enCampo]);

  const lugar = (donde?.lugar || '').trim();
  const gpsListo = !!gps && typeof gps === 'object';
  const campoListo = enCampo && gps !== 'negado' && (!!lugar || gpsListo);
  const sugeridos = useMemo(() => (enCampo ? sugerenciasDeLugar(lugares, donde?.lugar || '', gpsListo ? gps : null) : []),
    [enCampo, lugares, donde?.lugar, gpsListo, gps]);
  const claveSugeridos = sugeridos.map((x) => x.lugar).join('|');
  const claveAnterior = useRef('');
  if (claveAnterior.current !== claveSugeridos) {
    claveAnterior.current = claveSugeridos;
    LayoutAnimation.configureNext(LayoutAnimation.create(180, 'easeInEaseOut', 'opacity'));
  }

  const visibles = useMemo(() => {
    if (!efectivo) return [];
    if (enCampo) return (encuestas || []).filter((e) => e.canales.includes('campo'));
    return (encuestas || []).filter((e) => (e.canales.includes('entrevista') || e.canales.includes('kiosco'))
      && e.sucursales.some((s) => s.branch_id === efectivo.sala));
  }, [encuestas, efectivo, enCampo]);

  const volver = () => { setEntrevista(null); cargar(); };

  if (entrevista) {
    const encuesta = entrevista;
    const zona = enCampo ? zonaDe(encuesta) : null;
    // La entrevista ocupa la pantalla: la barra opaca (la pantalla empieza
    // debajo de ella, no detrás) y sin el gesto de volver, que sacaba de
    // Aplicar encuesta a media entrevista. Para salir está «Salir».
    return (
      <>
        <Stack.Screen options={{ ...BARRA_NATIVA, headerTransparent: false, headerStyle: { backgroundColor: 'transparent' },
          title: 'Entrevista', headerLargeTitle: false, headerBackVisible: false, gestureEnabled: false }} />
        <Formulario encuesta={encuesta} onEntregarMuestra={marcarMuestraEntregada} onSalir={volver}
          contexto={enCampo ? [zona ? nombreDeZona(zonasDe(encuesta), zona) : 'Campo', lugar].filter(Boolean).join(' · ') : nombreSala ?? 'La sucursal'}
          instruccion="Lee cada pregunta tal como está escrita y marca lo que responde el cliente, sin sugerirle la respuesta."
          onReiniciar={() => { if (seCerro.current) { seCerro.current = false; volver(); } }}
          onEnviar={async (respuestas, contacto, segundos, referencia) => {
            let r;
            if (enCampo) {
              // La ubicación se lee al guardar: el encuestador camina.
              const p = await leerPosicion({ espera: 8000 });
              if (p) setGps(p);
              else if (await ubicacionNegada()) {
                setGps('negado');
                throw new Error('Sin permiso de ubicación no se puede guardar. Actívalo en Ajustes y vuelve a enviar.');
              }
              const pos = p || (gpsListo ? gps : null);
              r = await guardarEntrevistaCampo(encuesta.id,
                { lugar: lugar || null, zona, ...(pos ? { lat: pos.lat, lng: pos.lng, precision: pos.precision } : {}) },
                { respuestas, contacto, segundos, referencia });
            } else {
              r = await guardarEntrevista(encuesta.id, efectivo.sala, { respuestas, contacto, segundos, referencia });
            }
            if (r?.cerrada) { seCerro.current = true; listo('La encuesta llegó a su meta', 'Se cerró sola. ¡Gracias!'); }
            return r;
          }} />
      </>
    );
  }

  const opcionesDonde = [
    ...salas.map((s) => ({ id: s.id, label: s.nombre, detalle: s.id === miSala ? 'tu sucursal de hoy' : null })),
    ...(hayCampo ? [{ id: CAMPO, label: 'Campo (fuera de las sucursales)', detalle: 'mercados, parques, la calle' }] : []),
  ];
  const mostrarLista = !efectivo || eligiendo;

  return (
    <>
      {/* Las opciones de la barra se SUMAN a las anteriores: lo que la entrevista
          cambió (sin «volver», sin gesto, barra opaca) hay que devolverlo aquí.
          Sin esto, al salir de una entrevista la pantalla quedaba sin forma de
          regresar y había que cerrar la app (usuario, 2026-11-19). */}
      <Stack.Screen options={{ ...BARRA_NATIVA, headerTransparent: !!BARRA_NATIVA.headerTransparent, headerStyle: BARRA_NATIVA.headerStyle,
        headerBackVisible: true, gestureEnabled: true, title: 'Aplicar encuesta', headerLargeTitle: true }} />
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
                {/* Los lugares que ya usó el equipo: cerca de aquí o que coinciden con lo escrito.
                    Elegir uno evita que el mismo sitio quede con dos nombres. */}
                {sugeridos.length ? (
                  <View style={{ gap: 6 }}>
                    <Text style={{ color: colorSistema.texto2, fontSize: 13 }}>
                      {(donde?.lugar || '').trim() ? 'Ya registrados' : '¿Estás en alguno de estos?'}
                    </Text>
                    <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8 }}>
                      {sugeridos.map((x) => (
                        <Pressable key={x.lugar} onPress={() => escribirLugar(x.lugar)}
                          accessibilityRole="button" accessibilityLabel={`Usar ${x.lugar}`}
                          style={{ minHeight: 44, paddingHorizontal: 14, borderRadius: 22, justifyContent: 'center',
                            backgroundColor: 'rgba(127,127,127,0.14)', borderWidth: 1, borderColor: x.cerca ? MARCA.azulClaro : 'rgba(127,127,127,0.2)' }}>
                          <Text style={{ color: colorSistema.texto, fontSize: 15, fontWeight: '600' }} numberOfLines={1}>{x.lugar}</Text>
                          {x.distancia != null ? (
                            <Text style={{ color: colorSistema.texto2, fontSize: 12 }}>{distanciaDeLugar(x.distancia)}</Text>
                          ) : null}
                        </Pressable>
                      ))}
                    </View>
                  </View>
                ) : null}
                {/* Alto fijo: al llegar la ubicación (o «Reintentar») la tarjeta no salta. */}
                <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8, height: 32 }}>
                  <Text style={{ flex: 1, color: colorSistema.texto2, fontSize: 13 }}>
                    {gps === 'buscando' ? 'Buscando la ubicación…'
                      : gpsListo ? `Ubicación activa${gps.precision ? ` (±${Math.round(gps.precision)} m)` : ''}`
                        : gps === 'negado' ? 'Sin permiso de ubicación.'
                          : 'Sin ubicación: escribe el lugar.'}
                  </Text>
                  {gps === 'sin' ? (
                    <Pressable onPress={buscarUbicacion} hitSlop={12} style={{ height: 32, justifyContent: 'center' }}>
                      <Text style={{ color: MARCA.azulClaro, fontSize: 15 }}>Reintentar</Text>
                    </Pressable>
                  ) : null}
                  {gps === 'negado' ? (
                    <Pressable onPress={() => Linking.openSettings()} hitSlop={12} style={{ height: 32, justifyContent: 'center' }}
                      accessibilityRole="button" accessibilityLabel="Abrir Ajustes para dar el permiso de ubicación">
                      <Text style={{ color: MARCA.azulClaro, fontSize: 15 }}>Abrir Ajustes</Text>
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
          const zonas = enCampo ? zonasDe(e) : [];
          const zona = enCampo ? zonaDe(e) : null;
          const puedeEmpezar = enCampo && campoListo && (!zonas.length || !!zona);
          return (
            <Tarjeta key={e.id}>
              <Text style={{ color: colorSistema.texto, fontSize: 17, fontWeight: '700' }}>{e.nombre}</Text>
              {e.objetivo ? <Text style={{ color: colorSistema.texto2, fontSize: 13 }} numberOfLines={3}>{e.objetivo}</Text> : null}
              <View style={{ flexDirection: 'row', gap: 6, flexWrap: 'wrap' }}>
                <Pildora texto={`${cuantasPreguntas(e.cuestionario)} preguntas`} color={MARCA.azulClaro} />
                {e.fecha_fin ? <Pildora texto={`Hasta el ${fechaTexto(e.fecha_fin, { day: 'numeric', month: 'short' })}`} color={MARCA.violeta} /> : null}
                {e.incentivo_tipo === 'muestra' ? <Pildora texto="🎁 Muestra médica" color={MARCA.verde} /> : null}
                {e.incentivo_tipo === 'puntos' ? <Pildora texto={`🎁 ${e.incentivo_puntos} puntos`} color={MARCA.verde} /> : null}
              </View>
              {s ? (
                <Text style={{ color: colorSistema.texto2, fontSize: 13 }}>
                  {`${llevas}${s.meta ? ` de ${s.meta}` : ''} respuesta${(s.meta || llevas) === 1 ? '' : 's'} en ${s.nombre}`}
                </Text>
              ) : null}
              {zonas.length ? (
                <View style={{ gap: 2 }}>
                  <Text style={{ color: colorSistema.texto2, fontSize: 13 }}>¿En qué zona estás?</Text>
                  <Opciones valor={zona} onCambiar={(v) => elegirZona(e.id, v)}
                    opciones={zonas.map((z) => ({ id: z.id, label: z.nombre, detalle: `${avanceDeZona(z)} respuestas` }))} />
                </View>
              ) : null}
              {(enCampo ? e.canales.includes('campo') : e.canales.includes('entrevista')) ? (
                <BotonGrande texto="Entrevistar" color={MARCA.azul} deshabilitado={enCampo && !puedeEmpezar} onPress={() => setEntrevista(e)} />
              ) : null}
              {enCampo && gps === 'negado' ? <Text style={{ color: colorSistema.texto2, fontSize: 12 }}>Da el permiso de ubicación a FarmaSalud para empezar.</Text> : null}
              {enCampo && !campoListo && gps !== 'negado' ? <Text style={{ color: colorSistema.texto2, fontSize: 12 }}>Escribe el lugar o activa la ubicación para empezar.</Text> : null}
              {enCampo && campoListo && zonas.length > 0 && !zona ? <Text style={{ color: colorSistema.texto2, fontSize: 12 }}>Elige la zona para empezar.</Text> : null}
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
