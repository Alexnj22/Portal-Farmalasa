// Ajustes de una encuesta a clientes, NATIVO — `AjustesEncuesta` del portal:
// nombre y objetivo; cómo se aplica (QR, entrevista, tablet); dónde y cuántas
// respuestas (meta general o por sucursal, con la muestra sugerida para ±5% y
// 95% de confianza); cuándo; qué recibe el cliente; y los textos que ve.
//
// Como el portal, NO hay botón de guardar: cada cambio se escribe solo un
// instante después (`guardarDiseno`), y lo pendiente se escribe igual al salir.
// Las sucursales van aparte (`guardarSucursales`) porque viven en su propia
// tabla con el token del QR de cada una. Sólo se edita en borrador y con
// permiso; si no, se ve igual, sin controles. Las cuentas son del núcleo.
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { ActivityIndicator, KeyboardAvoidingView, ScrollView, Switch, Text, View } from 'react-native';
import { Stack, useLocalSearchParams } from 'expo-router';
import * as Haptics from 'expo-haptics';
import { useAuth } from '@nucleo/context/AuthContext';
import { fetchEncuesta, fetchPoblacion, fetchSalas, guardarDiseno, guardarSucursales } from '@nucleo/data/encuestasClientes';
import {
  CANALES, INCENTIVOS, canalesCon, conMetaDeSucursal, conMetasSugeridas, metaTotal, muestraSugerida, numeroDeMetaEscrito,
  sucursalesCon, sugeridaDeLaEncuesta,
} from '@nucleo/utils/encuestasClientes';
import { formatQty } from '@nucleo/utils/formatNumber';
import { mensajeAmigable } from '@nucleo/utils/errorMessages';
import { BARRA_NATIVA } from '../../componentes/PilaDePestana';
import { colorSistema } from '../../componentes/Formulario';
import { Aviso, Campo, Opciones, Seccion } from '../../componentes/formulario/Piezas';
import FechaOpcional from '../../componentes/torogoz/bodega/FechaOpcional';
import { MARCA } from '../../componentes/inicio/marca';
import { fallo } from '../../componentes/Progreso';
import Tocable from '../../componentes/Tocable';

const RETARDO = 900;
const ESTADO_GUARDADO = { listo: 'Guardado', pendiente: 'Sin guardar…', guardando: 'Guardando…', error: 'No se guardó' };

function Interruptor({ titulo, detalle, valor, onCambiar, editable }) {
  return (
    <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10 }}>
      <View style={{ flex: 1 }}>
        <Text style={{ color: colorSistema.texto, fontSize: 15 }}>{titulo}</Text>
        {detalle ? <Text style={{ color: colorSistema.texto2, fontSize: 12 }}>{detalle}</Text> : null}
      </View>
      <Switch value={!!valor} disabled={!editable} onValueChange={onCambiar} />
    </View>
  );
}

export default function AjustesEncuesta() {
  const { id } = useLocalSearchParams();
  const { hasPermission } = useAuth();
  const [encuesta, setEncuesta] = useState(null);
  const [sucursales, setSucursales] = useState([]);
  const [salas, setSalas] = useState([]);
  const [poblacion, setPoblacion] = useState({});
  const [error, setError] = useState(null);
  const [estado, setEstado] = useState('listo');
  const pendientes = useRef({});
  const temporizador = useRef(null);
  const guardadas = useRef([]);

  useEffect(() => {
    Promise.all([fetchEncuesta(id), fetchSalas(), fetchPoblacion().catch(() => ({}))])
      .then(([e, s, p]) => { setEncuesta(e); setSucursales(e?.sucursales || []); guardadas.current = e?.sucursales || []; setSalas(s || []); setPoblacion(p || {}); })
      .catch((err) => setError(mensajeAmigable(err, 'No se pudo cargar la encuesta.')));
  }, [id]);

  const editable = !!encuesta && encuesta.estado === 'borrador' && hasPermission('encuestas_clientes', 'can_edit');

  const guardarYa = useCallback(async () => {
    clearTimeout(temporizador.current);
    const cambios = pendientes.current;
    if (!Object.keys(cambios).length) return;
    pendientes.current = {};
    setEstado('guardando');
    try {
      await guardarDiseno(id, cambios);
      setEstado(Object.keys(pendientes.current).length ? 'pendiente' : 'listo');
    } catch (err) {
      // Lo que no entró vuelve a la cola, debajo de lo que se escribió después.
      pendientes.current = { ...cambios, ...pendientes.current };
      setEstado('error');
      fallo('No se guardó el último cambio', mensajeAmigable(err, 'Se reintenta con el próximo cambio.'));
    }
  }, [id]);
  const alSalir = useRef(guardarYa);
  useEffect(() => { alSalir.current = guardarYa; }, [guardarYa]);
  useEffect(() => () => { alSalir.current(); }, []);

  const cambiar = (c) => {
    setEncuesta((e) => ({ ...e, ...c }));
    pendientes.current = { ...pendientes.current, ...c };
    setEstado('pendiente');
    clearTimeout(temporizador.current);
    temporizador.current = setTimeout(guardarYa, RETARDO);
  };
  const set = (k) => (v) => cambiar({ [k]: v });
  const cambiarSucursales = async (lista) => {
    setSucursales(lista);
    setEstado('guardando');
    try {
      await guardarSucursales(id, lista, guardadas.current);
      guardadas.current = lista;
      setEstado('listo');
    } catch (err) {
      setEstado('error');
      setSucursales(guardadas.current);
      fallo('No se guardaron las sucursales', mensajeAmigable(err, 'Intenta de nuevo.'));
    }
  };

  const elegidas = useMemo(() => new Map(sucursales.map((s) => [s.branch_id, s])), [sucursales]);
  if (error) return <View style={{ padding: 16 }}><Aviso tono="freno" texto={error} /></View>;
  if (!encuesta) return <ActivityIndicator style={{ marginTop: 32 }} />;
  const porSala = encuesta.alcance === 'sucursales';
  const meta = metaTotal(encuesta, sucursales);
  const sugerida = sugeridaDeLaEncuesta(encuesta, sucursales, poblacion);
  const conEntrevista = (encuesta.canales || []).includes('entrevista');

  return (
    <>
      <Stack.Screen options={{ ...BARRA_NATIVA, title: 'Ajustes', headerRight: () => <Text style={{ color: estado === 'error' ? MARCA.rojo : colorSistema.texto2, fontSize: 13 }}>{editable ? ESTADO_GUARDADO[estado] : 'Sólo lectura'}</Text> }} />
      <KeyboardAvoidingView behavior="padding" style={{ flex: 1 }}>
        <ScrollView style={{ flex: 1 }} contentContainerStyle={{ padding: 16, gap: 16, paddingBottom: 60 }} contentInsetAdjustmentBehavior="automatic" keyboardDismissMode="interactive">
          {!editable ? <Aviso texto="Sólo se edita en borrador y con permiso de editar encuestas." /> : null}
          <Seccion titulo="La encuesta">
            <Campo multiline={false} editable={editable} placeholder="Ej. Satisfacción en sala — octubre" value={encuesta.nombre} onChangeText={set('nombre')} />
            <Campo editable={editable} placeholder="Qué queremos saber" value={encuesta.objetivo || ''} onChangeText={set('objetivo')} />
          </Seccion>
          {!encuesta.es_plantilla ? (
            <>
              <Seccion titulo="Cómo se aplica">
                {CANALES.map((c) => (
                  <Interruptor key={c.value} titulo={c.label} detalle={c.ayuda} editable={editable}
                    valor={(encuesta.canales || []).includes(c.value)} onCambiar={(on) => set('canales')(canalesCon(encuesta.canales, c.value, on))} />
                ))}
              </Seccion>
              <Seccion titulo="Dónde y cuántas respuestas" pie={porSala ? 'Cada sucursal tiene su cuota: la encuesta termina cuando todas la cumplen.' : 'Se reparte en las sucursales elegidas y cuenta el total.'}>
                {editable ? <Opciones valor={encuesta.alcance} onCambiar={set('alcance')} opciones={[{ id: 'general', label: 'Meta general' }, { id: 'sucursales', label: 'Meta por sucursal' }]} />
                  : <Text style={{ color: colorSistema.texto, fontSize: 15 }}>{porSala ? 'Meta por sucursal' : 'Meta general'}</Text>}
                {salas.map((s) => {
                  const fila = elegidas.get(s.id);
                  const tickets = poblacion[s.id] || 0;
                  return (
                    <View key={s.id} style={{ gap: 6, borderTopWidth: 0.5, borderTopColor: colorSistema.separador, paddingTop: 8 }}>
                      <Interruptor titulo={s.name} editable={editable} valor={!!fila}
                        detalle={tickets ? `${formatQty(tickets)} atenciones en 30 días · muestra sugerida ${muestraSugerida(tickets)}` : null}
                        onCambiar={(on) => cambiarSucursales(sucursalesCon(sucursales, s.id, on))} />
                      {porSala && fila ? (
                        <Campo multiline={false} editable={editable} keyboardType="number-pad" placeholder="Meta de esta sucursal" value={fila.meta == null ? '' : String(fila.meta)}
                          onChangeText={(v) => cambiarSucursales(conMetaDeSucursal(sucursales, s.id, v))} />
                      ) : null}
                    </View>
                  );
                })}
                {editable && sucursales.length ? (
                  <View style={{ gap: 6 }}>
                    <Text style={{ color: colorSistema.texto2, fontSize: 13 }}>{`Para un margen de ±5% con 95% de confianza: ${porSala ? `${sugerida} en total (cada sucursal por separado)` : `${sugerida ?? '—'} respuestas`}`}</Text>
                    {porSala ? (
                      <Tocable onPress={() => { Haptics.selectionAsync().catch(() => {}); cambiarSucursales(conMetasSugeridas(sucursales, poblacion)); }} hitSlop={8} style={{ alignSelf: 'flex-start', minHeight: 36, justifyContent: 'center' }}>
                        <Text style={{ color: MARCA.azulClaro, fontSize: 15, fontWeight: '600' }}>Usar las sugeridas</Text>
                      </Tocable>
                    ) : sugerida ? (
                      <Tocable onPress={() => set('meta_total')(sugerida)} hitSlop={8} style={{ alignSelf: 'flex-start', minHeight: 36, justifyContent: 'center' }}>
                        <Text style={{ color: MARCA.azulClaro, fontSize: 15, fontWeight: '600' }}>{`Usar ${sugerida}`}</Text>
                      </Tocable>
                    ) : null}
                  </View>
                ) : null}
                {!porSala ? (
                  <Campo multiline={false} editable={editable} keyboardType="number-pad" placeholder="Meta de respuestas (sin meta)" value={encuesta.meta_total == null ? '' : String(encuesta.meta_total)}
                    onChangeText={(v) => set('meta_total')(numeroDeMetaEscrito(v))} />
                ) : null}
              </Seccion>
              <Seccion titulo="Cuándo" pie={`Se cierra con lo primero que pase: la fecha${meta ? ` o las ${meta} respuestas` : ''}. Sin fecha de inicio, empieza el día que se publica.`}>
                <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' }}>
                  <Text style={{ color: colorSistema.texto, fontSize: 16 }}>Desde</Text>
                  {editable ? <FechaOpcional valor={encuesta.fecha_inicio || null} onCambiar={(v) => set('fecha_inicio')(v || null)} />
                    : <Text style={{ color: colorSistema.texto2, fontSize: 15 }}>{encuesta.fecha_inicio || 'Al publicarla'}</Text>}
                </View>
                <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' }}>
                  <Text style={{ color: colorSistema.texto, fontSize: 16 }}>Hasta</Text>
                  {editable ? <FechaOpcional valor={encuesta.fecha_fin || null} onCambiar={(v) => set('fecha_fin')(v || null)} />
                    : <Text style={{ color: colorSistema.texto2, fontSize: 15 }}>{encuesta.fecha_fin || 'Sin fecha'}</Text>}
                </View>
                {encuesta.fecha_inicio && encuesta.fecha_fin && encuesta.fecha_fin < encuesta.fecha_inicio ? <Aviso tono="cuidado" texto="La fecha final es antes que la inicial." /> : null}
              </Seccion>
              <Seccion titulo="Qué recibe el cliente">
                {editable ? <Opciones valor={encuesta.incentivo_tipo} onCambiar={set('incentivo_tipo')} opciones={INCENTIVOS.map((i) => ({ id: i.value, label: i.label }))} />
                  : <Text style={{ color: colorSistema.texto, fontSize: 15 }}>{INCENTIVOS.find((i) => i.value === encuesta.incentivo_tipo)?.label}</Text>}
                {encuesta.incentivo_tipo !== 'ninguno' ? (
                  <Aviso texto={`Sólo lo recibe quien deja su teléfono y acepta el consentimiento, y una sola vez por encuesta.${encuesta.incentivo_tipo === 'puntos' ? ' Los puntos se acreditan solos en su cuenta.' : ''}${encuesta.incentivo_tipo === 'muestra' ? ' La entrega quien entrevista, y la marca como entregada.' : ''}`} />
                ) : null}
                {encuesta.incentivo_tipo === 'muestra' && !conEntrevista ? <Aviso tono="cuidado" texto="La muestra médica sólo se entrega en entrevista. Marca ese canal." /> : null}
                {encuesta.incentivo_tipo === 'puntos' ? (
                  <Campo multiline={false} editable={editable} keyboardType="number-pad" placeholder="Puntos por responder" value={encuesta.incentivo_puntos == null ? '' : String(encuesta.incentivo_puntos)}
                    onChangeText={(v) => set('incentivo_puntos')(numeroDeMetaEscrito(v))} />
                ) : null}
                {encuesta.incentivo_tipo !== 'ninguno' ? (
                  <Campo multiline={false} editable={editable} value={encuesta.incentivo_descripcion || ''} onChangeText={set('incentivo_descripcion')}
                    placeholder={encuesta.incentivo_tipo === 'muestra' ? 'Qué muestra se entrega (ej. sobre de suero oral)' : 'Cómo se le explica (ej. gana 50 puntos por tu opinión)'} />
                ) : null}
              </Seccion>
            </>
          ) : null}
          <Seccion titulo="Lo que ve el cliente">
            <Campo editable={editable} placeholder="Bienvenida (opcional)" value={encuesta.mensaje_bienvenida || ''} onChangeText={set('mensaje_bienvenida')} />
            <Campo editable={editable} placeholder="Al terminar: ¡Gracias por tu opinión!" value={encuesta.mensaje_cierre || ''} onChangeText={set('mensaje_cierre')} />
            {!encuesta.es_plantilla ? (
              <>
                <Campo editable={editable} placeholder="Consentimiento para guardar sus datos" value={encuesta.texto_consentimiento || ''} onChangeText={set('texto_consentimiento')} />
                <Text style={{ color: colorSistema.texto2, fontSize: 12 }}>Se muestra sólo si el cliente quiere dejar su ficha o teléfono. Sin aceptarlo, la respuesta queda anónima.</Text>
              </>
            ) : null}
          </Seccion>
        </ScrollView>
      </KeyboardAvoidingView>
    </>
  );
}
