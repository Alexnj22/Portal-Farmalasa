// Solicitudes sobre datos personales, NATIVO — `SolicitudesDatosView` para
// vigilar los plazos: las solicitudes en trámite, resueltas o todas, cada una
// con su formulario, quién la pide, qué derechos ejerce, cuándo se recibió y
// cuántos días hábiles le quedan (el Art. 20 da veinte; cuarenta con
// prórroga). Arriba, cuántas vencieron y cuántas vencen en tres días o menos.
//
// El plazo y los filtros salen del núcleo (`data/solicitudesDatos`), lo mismo
// del portal. «Nueva solicitud» toma el correlativo y saca el formulario
// numerado (el mismo papel del portal, `papelDeSolicitudDeDatos`) por AirPrint
// o en PDF; cada solicitud se reimprime, se registra y se resuelve en
// `solicitud-datos/[id]`, donde se arma también la respuesta.
//
// Como el portal, se filtra además por estado y por período (la fecha en que
// se recibió, o se imprimió si todavía no llegó): `filtrarSolicitudes`.
import { useCallback, useMemo, useState } from 'react';
import { ActionSheetIOS, ActivityIndicator, Alert, RefreshControl, ScrollView, Text, View } from 'react-native';
import { useEnTramos } from '../componentes/alFinal';
import { router, Stack, useFocusEffect } from 'expo-router';
import * as Haptics from 'expo-haptics';
import { alarmasDePlazo, crearSolicitud, DERECHOS, ESTADOS, fetchSolicitudes, filtrarSolicitudes, plazoDe } from '@nucleo/data/solicitudesDatos';
import { papelDeSolicitudDeDatos } from '@nucleo/generated/formularioDatos';
import { useAuth } from '@nucleo/context/AuthContext';
import { mensajeAmigable } from '@nucleo/utils/errorMessages';
import { tokenMatch } from '@nucleo/utils/searchUtils';
import { fechaTexto, hoySV, sumarDias } from '@nucleo/utils/fecha';
import { FiltrosActivos, MenuDeFiltros } from '../componentes/Filtros';
import Segmentos from '../componentes/Segmentos';
import { BARRA_NATIVA } from '../componentes/PilaDePestana';
import { colorSistema } from '../componentes/Formulario';
import { Aviso, BotonGrande, Dato } from '../componentes/formulario/Piezas';
import { Pildora } from '../componentes/avisos/Piezas';
import Vidrio from '../componentes/Vidrio';
import { MARCA } from '../componentes/inicio/marca';
import { fallo } from '../componentes/Progreso';
import { compartirPdf, imprimirPapel } from '../componentes/pdf';
import Tocable from '../componentes/Tocable';

const ROTULO = Object.fromEntries(DERECHOS.map((d) => [d.clave, d.rotulo]));
// Un instante (timestamptz o Date): `fechaTexto` lo lleva al día de El Salvador.
const fecha = (v) => (v ? fechaTexto(v, { day: 'numeric', month: 'short', year: 'numeric' }) : '—');

// El formulario numerado sale por AirPrint o como PDF para mandarlo a otra impresora.
function sacarFormulario(folio) {
  const html = papelDeSolicitudDeDatos(folio);
  ActionSheetIOS.showActionSheetWithOptions(
    { title: `Formulario ${folio}`, options: ['Imprimir', 'Compartir en PDF', 'Cancelar'], cancelButtonIndex: 2 },
    async (i) => {
      try {
        if (i === 0) await imprimirPapel(html);
        else if (i === 1) await compartirPdf({ html, nombre: `Solicitud ${folio}` });
      } catch (e) {
        fallo('No se pudo imprimir', mensajeAmigable(e));
      }
    },
  );
}

export default function SolicitudesDatos() {
  const { user } = useAuth();
  const [filas, setFilas] = useState(null);
  const [error, setError] = useState(null);
  const [pestana, setPestana] = useState('tramite');
  const [texto, setTexto] = useState('');
  const [abierta, setAbierta] = useState(null);
  const [recargando, setRecargando] = useState(false);
  const [estado, setEstado] = useState('TODOS');
  const [periodo, setPeriodo] = useState('todo');

  const cargar = useCallback(async () => {
    try { setFilas(await fetchSolicitudes()); setError(null); } catch (e) { setError(e?.message || 'No se pudo cargar.'); setFilas([]); }
  }, []);
  // Al volver de registrar o resolver una, la lista se relee.
  useFocusEffect(useCallback(() => { cargar(); }, [cargar]));

  const nueva = () => Alert.alert('Nueva solicitud',
    'Se toma el siguiente número de formulario y se imprime la hoja para que la persona la llene.', [
      { text: 'Cancelar', style: 'cancel' },
      { text: 'Tomar número', onPress: async () => {
        try {
          // `crearSolicitud` anota `IMPRIMIR_SOLICITUD_DATOS` al nacer la hoja.
          const fila = await crearSolicitud(user?.branchId ?? null);
          await cargar();
          sacarFormulario(fila.folio_txt);
        } catch (e) {
          fallo('No se pudo crear la solicitud', mensajeAmigable(e));
        }
      } },
    ]);

  const desde = periodo === 'todo' ? '' : periodo === 'mes' ? `${hoySV().slice(0, 7)}-01` : sumarDias(hoySV(), -(Number(periodo) - 1));
  const visibles = useMemo(() => filtrarSolicitudes(filas, { pestana, estado, desde, texto }, tokenMatch), [filas, pestana, estado, desde, texto]);
  const tramo = useEnTramos(visibles, 40, `${pestana}|${estado}|${desde}|${texto}`);
  const grupos = [
    { id: 'periodo', titulo: 'Período', activa: periodo, porDefecto: 'todo', onCambiar: setPeriodo,
      opciones: [{ id: 'todo', label: 'Todo' }, { id: '7', label: 'Últimos 7 días' }, { id: '30', label: 'Últimos 30 días' }, { id: 'mes', label: 'Este mes' }, { id: '365', label: 'Último año' }] },
    { id: 'estado', titulo: 'Estado', activa: estado, porDefecto: 'TODOS', onCambiar: setEstado,
      opciones: [{ id: 'TODOS', label: 'Todos' }, ...Object.entries(ESTADOS).map(([k, v]) => ({ id: k, label: v.rotulo }))] },
  ];
  const { vencidas, apremian } = useMemo(() => alarmasDePlazo(filas), [filas]);

  return (
    <>
      <Stack.Screen options={{
        ...BARRA_NATIVA, title: 'Solicitudes de datos', headerLargeTitle: true,
        headerSearchBarOptions: {
          placeholder: 'Formulario, nombre o documento', hideWhenScrolling: false,
          onChangeText: (e) => setTexto(e.nativeEvent.text), onCancelButtonPress: () => setTexto(''),
        },
      }} />
      <MenuDeFiltros grupos={grupos} />
      <ScrollView {...tramo.scroll} style={{ flex: 1 }} contentContainerStyle={{ paddingVertical: 12, gap: 10, paddingBottom: 48 }}
        contentInsetAdjustmentBehavior="automatic" keyboardDismissMode="on-drag"
        refreshControl={<RefreshControl refreshing={recargando} onRefresh={async () => { setRecargando(true); await cargar(); setRecargando(false); }} />}>
        <Segmentos activa={pestana} onCambiar={setPestana} opciones={[{ id: 'tramite', label: 'En trámite' }, { id: 'resueltas', label: 'Resueltas' }, { id: 'todas', label: 'Todas' }]} />
        <FiltrosActivos grupos={grupos} />
        {error ? <View style={{ marginHorizontal: 16 }}><Aviso tono="freno" texto={error} /></View> : null}
        {vencidas || apremian ? (
          <View style={{ marginHorizontal: 16 }}>
            <Aviso tono={vencidas ? 'freno' : 'cuidado'} texto={[vencidas ? `${vencidas} vencida${vencidas === 1 ? '' : 's'}` : null, apremian ? `${apremian} vence${apremian === 1 ? '' : 'n'} en 3 días hábiles o menos` : null].filter(Boolean).join(' · ')} />
          </View>
        ) : null}
        {filas == null ? <ActivityIndicator style={{ marginTop: 24 }} /> : tramo.visibles.map((s) => {
          const plazo = plazoDe(s);
          const abiertaEsta = abierta === s.id;
          return (
            <Tocable key={s.id} onPress={() => { Haptics.selectionAsync().catch(() => {}); setAbierta(abiertaEsta ? null : s.id); }} style={{ marginHorizontal: 16 }}>
              <Vidrio radio={18} interactivo tinte={plazo?.vencida ? 'rgba(240,68,56,0.12)' : undefined}>
                <View style={{ padding: 12, gap: 6 }}>
                  <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
                    <Text style={{ color: colorSistema.texto, fontSize: 15, fontWeight: '700' }}>{s.folio_txt}</Text>
                    <Text style={{ flex: 1, color: colorSistema.texto, fontSize: 15 }} numberOfLines={1}>{s.solicitante_nombre || 'Hoja sin llenar'}</Text>
                    {plazo ? <Pildora texto={plazo.vencida ? `Vencida hace ${Math.abs(plazo.restan)}` : `${plazo.restan} d. hábiles`} color={plazo.vencida ? MARCA.rojo : plazo.apremia ? MARCA.ambar : colorSistema.texto2} /> : null}
                  </View>
                  <View style={{ flexDirection: 'row', gap: 6, flexWrap: 'wrap' }}>
                    <Pildora texto={ESTADOS[s.estado]?.rotulo ?? s.estado} color={s.estado === 'RESUELTA' ? MARCA.verde : MARCA.azulClaro} />
                    {(s.derechos || []).map((d) => <Pildora key={d} texto={ROTULO[d] ?? d} color={MARCA.violeta} />)}
                  </View>
                  {abiertaEsta ? (
                    <View style={{ marginTop: 4 }}>
                      <Dato rotulo="Estado" valor={ESTADOS[s.estado]?.que ?? s.estado} primero />
                      <Dato rotulo="Impresa" valor={fecha(s.impresa_at)} />
                      <Dato rotulo="Recibida" valor={fecha(s.recibida_at)} />
                      {plazo ? <Dato rotulo="Vence" valor={fecha(plazo.vence)} /> : null}
                      {s.prorrogada_at ? <Dato rotulo="Prorrogada" valor={fecha(s.prorrogada_at)} /> : null}
                      {s.resuelta_at ? <Dato rotulo="Resuelta" valor={fecha(s.resuelta_at)} /> : null}
                      {s.solicitante_numero ? <Dato rotulo="Documento" valor={s.solicitante_numero} /> : null}
                      {s.descripcion ? <Text style={{ color: colorSistema.texto, fontSize: 14, marginTop: 8 }}>{s.descripcion}</Text> : null}
                      <View style={{ flexDirection: 'row', gap: 10, marginTop: 10 }}>
                        <View style={{ flex: 1 }}>
                          <BotonGrande texto="Reimprimir" borde onPress={() => sacarFormulario(s.folio_txt)} />
                        </View>
                        <View style={{ flex: 1 }}>
                          <BotonGrande texto={s.estado === 'RESUELTA' ? 'Ver' : s.estado === 'IMPRESA' ? 'Registrar' : 'Abrir'} color={MARCA.azul}
                            onPress={() => router.push({ pathname: '/solicitud-datos/[id]', params: { id: String(s.id) } })} />
                        </View>
                      </View>
                    </View>
                  ) : null}
                </View>
              </Vidrio>
            </Tocable>
          );
        })}
        {filas && !visibles.length ? <Text style={{ color: colorSistema.texto, fontSize: 17, fontWeight: '600', textAlign: 'center', marginTop: 40 }}>{texto.trim() ? 'Sin coincidencias' : 'Sin solicitudes aquí'}</Text> : null}
        <View style={{ marginHorizontal: 16, marginTop: 8 }}>
          <BotonGrande texto="Nueva solicitud" onPress={nueva} />
        </View>
      </ScrollView>
    </>
  );
}
