// Una pieza del calendario de marketing, NATIVO — lo de leer y decidir de
// `PiezaModal`: el texto, los hashtags y los diseños en grande; la REVISIÓN
// (Aprobar / Pedir cambios con lo que hay que cambiar) para quien aprueba, una
// vez enviada; «Enviar a revisión» de una pieza terminada para quien edita;
// el historial con quién hizo cada cambio, y la conversación (comentar y dar
// por resuelto). Las funciones son las del núcleo (`data/marketing`), así que
// la base decide igual que en el portal.
//
// Quien edita además la edita con sus diseños (`marketing-editar`), la pauta
// (`marketing-pauta`) y la duplica a otro mes (`duplicarPiezas`, la del portal).
//
// Y lo demás de `PiezaModal`: agregar un enlace (Drive, Canva) como diseño;
// liberarla para las salas (Galería) cuando ya está aprobada; quitarla (quien
// la creó, mientras no esté publicada); medir sus ventas si va ligada a una
// promoción; y en la conversación, editar o quitar el comentario propio
// mientras nadie haya respondido.
import { useCallback, useEffect, useMemo, useState } from 'react';
import { ActionSheetIOS, ActivityIndicator, Alert, Image, KeyboardAvoidingView, ScrollView, Text, View } from 'react-native';
import { router, Stack, useFocusEffect } from 'expo-router';
import * as Haptics from 'expo-haptics';
import { useAuth } from '@nucleo/context/AuthContext';
import {
  agregarEnlace, borrarPieza, comentar, duplicarPiezas, editarComentario, enviarPieza, fetchComentarios, fetchEfectoEnVentas, fetchHistorial,
  fetchPersonas, liberarPieza, marcarResuelto, quitarComentario, revisarPieza,
} from '@nucleo/data/marketing';
import { formatMoney, formatPct, formatQty } from '@nucleo/utils/formatNumber';
import { correrMes, etiquetaMes } from '@nucleo/utils/fecha';
import { aptoParaWhatsApp, estadoDe, formatoDe, fraseDeHistorial, tipoDeArchivo, variacionDeVentas } from '@nucleo/utils/marketing';
import { mensajeAmigable } from '@nucleo/utils/errorMessages';
import { shortEmployeeName } from '@nucleo/utils/nameUtils';
import { fechaHora12, hora12 } from '@nucleo/utils/hora';
import { fechaTexto } from '@nucleo/utils/fecha';
import { BARRA_NATIVA } from '../../componentes/PilaDePestana';
import { colorSistema } from '../../componentes/Formulario';
import { Aviso, BotonGrande, Campo, Seccion } from '../../componentes/formulario/Piezas';
import { Pildora } from '../../componentes/avisos/Piezas';
import Avatar from '../../componentes/Avatar';
import { MARCA } from '../../componentes/inicio/marca';
import { colorDeVariante } from '../../componentes/colorDeVariante';
import { piezaElegida } from '../../componentes/marketing/elegida';
import { fallo, listo } from '../../componentes/Progreso';
import Tocable from '../../componentes/Tocable';

function Quien({ id, personas }) {
  if (!id) return <Text style={{ color: colorSistema.texto2, fontSize: 13, fontWeight: '600' }}>Automático</Text>;
  const p = personas[id];
  return (
    <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
      <Avatar empleado={p || { id, name: '?' }} tamano={22} />
      <Text style={{ color: colorSistema.texto, fontSize: 13, fontWeight: '600' }}>{p?.name ? shortEmployeeName(p.name) : '—'}</Text>
    </View>
  );
}

export default function PiezaDeMarketing() {
  const { hasPermission, user } = useAuth();
  const puedeEditar = hasPermission('marketing', 'can_edit');
  const puedeAprobar = hasPermission('marketing', 'can_approve');
  const abierta = piezaElegida();
  const [pieza, setPieza] = useState(abierta?.pieza ?? null);
  // Al volver de editarla o pautarla, la pieza recordada trae lo guardado.
  useFocusEffect(useCallback(() => { const p = piezaElegida()?.pieza; if (p) setPieza(p); }, []));
  const mes = abierta?.mes ?? null;
  const firmas = abierta?.firmas ?? new Map();
  const [comentarios, setComentarios] = useState(null);
  const [historial, setHistorial] = useState([]);
  const [personas, setPersonas] = useState({});
  const [texto, setTexto] = useState('');
  const [ocupado, setOcupado] = useState(false);
  const [efecto, setEfecto] = useState(null);

  // Duplicar a otro mes: la copia nace pendiente, sin diseños ni pauta. «Semana»
  // la pone en la misma semana del mes; «día», en el mismo número de día.
  const duplicar = () => {
    const base = String(mes?.mes || pieza?.fecha || '').slice(0, 7);
    const destinos = [1, 2, 3].map((n) => correrMes(base, n));
    const opciones = [...destinos.map((m) => etiquetaMes(m)), 'Cancelar'];
    ActionSheetIOS.showActionSheetWithOptions({ title: 'Duplicar a', options: opciones, cancelButtonIndex: opciones.length - 1 }, (i) => {
      if (i >= destinos.length) return;
      const destino = destinos[i];
      ActionSheetIOS.showActionSheetWithOptions({ title: `Duplicar a ${etiquetaMes(destino)}`, message: 'La copia nace pendiente, sin diseños ni pauta.', options: ['Misma semana del mes', 'Mismo número de día', 'Cancelar'], cancelButtonIndex: 2 }, (j) => {
        if (j > 1) return;
        correr(() => duplicarPiezas([pieza.id], destino, j === 0 ? 'semana' : 'dia'), `Duplicada a ${etiquetaMes(destino)}`);
      });
    });
  };

  const cargar = useCallback(async () => {
    if (!mes?.id || !pieza?.id) return;
    try {
      const [c, h] = await Promise.all([fetchComentarios(mes.id), fetchHistorial(mes.id)]);
      const mios = (c || []).filter((x) => x.pieza_id === pieza.id);
      const suyo = (h || []).filter((x) => x.pieza_id === pieza.id);
      setComentarios(mios);
      setHistorial(suyo);
      setPersonas(await fetchPersonas([...mios.map((x) => x.autor_id), ...suyo.map((x) => x.actor)]));
    } catch { setComentarios([]); }
  }, [mes?.id, pieza?.id]);
  useEffect(() => { cargar(); }, [cargar]);

  const publicado = !!mes?.publicado_at || !!pieza?.enviada_at;
  const puedeRevisar = puedeAprobar && publicado && ['finalizado', 'cambios', 'aprobado'].includes(pieza?.estado);
  const puedeEnviarSola = puedeEditar && pieza?.estado === 'finalizado';
  const imagenes = useMemo(() => (pieza?.archivos || []).filter((a) => !a.reemplazado && tipoDeArchivo(a) === 'imagen' && firmas.get(a.url)), [pieza, firmas]);

  if (!pieza) return <View style={{ margin: 16 }}><Aviso tono="freno" texto="No se encontró la pieza. Vuelve a abrirla desde el calendario." /></View>;
  const est = estadoDe(pieza.estado);

  const correr = async (fn, exito, nuevoEstado) => {
    setOcupado(true);
    try {
      await fn();
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success).catch(() => {});
      listo(exito, pieza.titulo || '');
      if (nuevoEstado) setPieza((p) => ({ ...p, ...nuevoEstado }));
      cargar();
    } catch (e) {
      fallo('No se pudo completar', mensajeAmigable(e, 'Intenta de nuevo.'));
    } finally {
      setOcupado(false);
    }
  };

  const aprobar = () => Alert.alert('Aprobar la pieza', pieza.titulo || '', [
    { text: 'Cancelar', style: 'cancel' },
    { text: 'Aprobar', onPress: () => correr(() => revisarPieza(pieza.id, 'aprobar', null), 'Pieza aprobada', { estado: 'aprobado' }) },
  ]);
  const pedirCambios = () => Alert.prompt('Pedir cambios', '¿Qué hay que cambiar? Sé específico: texto, colores, producto, fecha…', [
    { text: 'Cancelar', style: 'cancel' },
    { text: 'Pedir cambios', onPress: (t) => {
      const v = String(t ?? '').trim();
      if (!v) { Alert.alert('Pedir cambios', 'Hace falta escribir qué cambiar.'); return; }
      correr(() => revisarPieza(pieza.id, 'cambios', v), 'Cambios pedidos', { estado: 'cambios' });
    } },
  ], 'plain-text');
  const enviarSola = () => Alert.alert(pieza.enviada_at ? 'Reenviar a revisión' : 'Enviar a revisión', 'Se manda sólo esta pieza a quien aprueba.', [
    { text: 'Cancelar', style: 'cancel' },
    { text: 'Enviar', onPress: () => correr(() => enviarPieza(pieza.id), 'Enviada a revisión', { enviada_at: new Date().toISOString() }) },
  ]);
  // ── Lo demás de la pieza (como `PiezaModal`) ──
  const yoId = user?.id;
  const esCreador = !pieza?.created_by || pieza.created_by === yoId;
  const puedeQuitar = puedeEditar && esCreador && pieza?.estado !== 'publicado';
  const sePuedeLiberar = ['aprobado', 'programado', 'publicado'].includes(pieza?.estado) && (puedeEditar || puedeAprobar);
  const quitar = () => Alert.alert('Quitar la pieza', `«${pieza.titulo || 'Pieza'}» se borra con sus diseños. Sólo se puede mientras está pendiente o en proceso.`, [
    { text: 'Cancelar', style: 'cancel' },
    { text: 'Quitar', style: 'destructive', onPress: async () => {
      setOcupado(true);
      try { await borrarPieza(pieza.id, pieza.titulo, pieza.archivos || []); listo('Pieza quitada', pieza.titulo || ''); router.back(); }
      catch (e) { fallo('No se pudo quitar', mensajeAmigable(e)); }
      setOcupado(false);
    } },
  ]);
  const liberar = (on) => Alert.alert(on ? 'Liberar para las salas' : 'Retener', on ? 'Las salas la ven en Galería y la pueden descargar para publicarla en WhatsApp.' : 'Deja de verse en la Galería de las salas.', [
    { text: 'Cancelar', style: 'cancel' },
    { text: on ? 'Liberar' : 'Retener', onPress: () => correr(() => liberarPieza(pieza.id, on), on ? 'Liberada para las salas' : 'Retenida', { liberada: on }) },
  ]);
  const enlace = () => Alert.prompt('Agregar un enlace', 'El diseño en Drive o Canva (https://…).', [
    { text: 'Cancelar', style: 'cancel' },
    { text: 'Agregar', onPress: (t) => {
      const v = String(t ?? '').trim();
      if (!/^https?:\/\//i.test(v)) { Alert.alert('Enlace', 'Tiene que empezar con http:// o https://'); return; }
      correr(async () => {
        const a = await agregarEnlace({ piezaId: pieza.id, enlace: v, orden: (pieza.archivos || []).length, subidoPor: yoId });
        setPieza((p) => ({ ...p, archivos: [...(p.archivos || []), a] }));
      }, 'Enlace agregado');
    } },
  ], 'plain-text', '', 'url');
  const medir = async () => {
    try { setEfecto((await fetchEfectoEnVentas(pieza.id)) || { vacio: true }); }
    catch (e) { fallo('No se pudo medir', mensajeAmigable(e)); }
  };
  const vEfecto = variacionDeVentas(efecto);
  const editarMio = (c) => Alert.prompt('Editar el comentario', '', [
    { text: 'Cancelar', style: 'cancel' },
    { text: 'Guardar', onPress: (t) => { if (String(t ?? '').trim()) correr(() => editarComentario(c.id, t), 'Comentario corregido'); } },
  ], 'plain-text', c.texto);
  const quitarMio = (c) => Alert.alert('Quitar el comentario', 'Se borra para todos.', [
    { text: 'Cancelar', style: 'cancel' }, { text: 'Quitar', style: 'destructive', onPress: () => correr(() => quitarComentario(c.id), 'Comentario quitado') },
  ]);

  const mandarComentario = () => {
    const v = texto.trim();
    if (!v) return;
    correr(async () => { await comentar({ mesId: mes.id, piezaId: pieza.id, texto: v, autorId: user?.id }); setTexto(''); }, 'Comentario enviado');
  };

  return (
    <>
      <Stack.Screen options={{ ...BARRA_NATIVA, title: formatoDe(pieza.formato).label, headerLargeTitle: false }} />
      <KeyboardAvoidingView behavior="padding" style={{ flex: 1 }}>
        <ScrollView style={{ flex: 1 }} contentContainerStyle={{ padding: 16, gap: 14, paddingBottom: 60 }} contentInsetAdjustmentBehavior="automatic" keyboardDismissMode="interactive">
          <View style={{ gap: 6 }}>
            <Text style={{ color: colorSistema.texto, fontSize: 20, fontWeight: '800' }}>{pieza.titulo || formatoDe(pieza.formato).label}</Text>
            <View style={{ flexDirection: 'row', gap: 6, flexWrap: 'wrap', alignItems: 'center' }}>
              <Pildora texto={est.label} color={colorDeVariante(est.variant)} />
              {pieza.pautar ? <Pildora texto="Con pauta" color={MARCA.violetaClaro} /> : null}
              <Text style={{ color: colorSistema.texto2, fontSize: 13 }}>
                {[pieza.fecha ? fechaTexto(pieza.fecha, { weekday: 'long', day: 'numeric', month: 'short' }) : null, pieza.hora ? hora12(pieza.hora) : null].filter(Boolean).join(' · ')}
              </Text>
            </View>
          </View>
          {pieza.copy || pieza.hashtags ? (
            <Seccion titulo="Texto">
              {pieza.copy ? <Text selectable style={{ color: colorSistema.texto, fontSize: 15 }}>{pieza.copy}</Text> : null}
              {pieza.hashtags ? <Text selectable style={{ color: MARCA.azulClaro, fontSize: 14 }}>{pieza.hashtags}</Text> : null}
            </Seccion>
          ) : null}
          {imagenes.map((a) => <Image key={a.id ?? a.url} source={{ uri: firmas.get(a.url) }} style={{ width: '100%', aspectRatio: 1, borderRadius: 16 }} resizeMode="cover" />)}
          {!imagenes.length ? <Aviso texto={(pieza.archivos || []).length ? 'Los diseños se ven cuando el mes o la pieza se envía a revisión.' : 'Sin diseños todavía.'} /> : null}

          {puedeRevisar ? (
            <Seccion titulo="Revisión">
              <View style={{ flexDirection: 'row', gap: 10 }}>
                {pieza.estado !== 'aprobado' ? (
                  <View style={{ flex: 1 }}><BotonGrande texto="Aprobar" color={MARCA.verde} onPress={aprobar} deshabilitado={ocupado} /></View>
                ) : null}
                <View style={{ flex: 1 }}><BotonGrande texto="Pedir cambios" color={MARCA.ambar} borde onPress={pedirCambios} deshabilitado={ocupado} /></View>
              </View>
            </Seccion>
          ) : null}
          {puedeEnviarSola ? <BotonGrande texto={pieza.enviada_at ? 'Reenviar a revisión' : 'Enviar a revisión'} color={MARCA.azul} borde onPress={enviarSola} deshabilitado={ocupado} /> : null}

          <Seccion titulo="Historial">
            {historial.length ? historial.map((h, i) => (
              <View key={h.id} style={{ gap: 3, paddingTop: i ? 8 : 0, borderTopWidth: i ? 0.5 : 0, borderTopColor: colorSistema.separador }}>
                <View style={{ flexDirection: 'row', alignItems: 'center' }}>
                  <View style={{ flex: 1 }}><Quien id={h.actor} personas={personas} /></View>
                  <Text style={{ color: colorSistema.texto2, fontSize: 12 }}>{fechaHora12(h.created_at, { day: 'numeric', month: 'short' })}</Text>
                </View>
                <Text style={{ color: colorSistema.texto2, fontSize: 13, marginLeft: 28 }}>{fraseDeHistorial(h)}</Text>
              </View>
            )) : <Text style={{ color: colorSistema.texto2, fontSize: 14 }}>Sin cambios todavía.</Text>}
          </Seccion>

          <Seccion titulo="Comentarios">
            {comentarios == null ? <ActivityIndicator /> : comentarios.length ? comentarios.map((c, i) => (
              <View key={c.id} style={{ gap: 3, paddingTop: i ? 8 : 0, borderTopWidth: i ? 0.5 : 0, borderTopColor: colorSistema.separador, opacity: c.resuelto ? 0.6 : 1 }}>
                <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
                  <View style={{ flex: 1 }}><Quien id={c.autor_id} personas={personas} /></View>
                  <Text style={{ color: colorSistema.texto2, fontSize: 12 }}>{fechaHora12(c.created_at, { day: 'numeric', month: 'short' })}</Text>
                </View>
                <Text style={{ color: colorSistema.texto, fontSize: 14, marginLeft: 28 }}>{c.texto}</Text>
                {c.marca ? <Text style={{ color: colorSistema.texto2, fontSize: 12, marginLeft: 28 }}>Marcado sobre un diseño (se ve en el portal)</Text> : null}
                <View style={{ flexDirection: 'row', gap: 16, marginLeft: 28 }}>
                  {puedeEditar || puedeAprobar ? (
                    <Tocable onPress={() => correr(() => marcarResuelto(c.id, !c.resuelto), c.resuelto ? 'Reabierto' : 'Resuelto')} hitSlop={6}>
                      <Text style={{ color: c.resuelto ? MARCA.ambar : MARCA.verde, fontSize: 13, fontWeight: '700' }}>{c.resuelto ? 'Reabrir' : 'Marcar resuelto'}</Text>
                    </Tocable>
                  ) : null}
                  {c.autor_id === yoId && c.tipo === 'comentario' ? (
                    <Tocable onPress={() => editarMio(c)} hitSlop={6}><Text style={{ color: MARCA.azulClaro, fontSize: 13, fontWeight: '600' }}>Editar</Text></Tocable>
                  ) : null}
                  {c.autor_id === yoId && c.tipo === 'comentario' && !c.respuestas?.length ? (
                    <Tocable onPress={() => quitarMio(c)} hitSlop={6}><Text style={{ color: MARCA.rojo, fontSize: 13, fontWeight: '600' }}>Quitar</Text></Tocable>
                  ) : null}
                </View>
              </View>
            )) : <Text style={{ color: colorSistema.texto2, fontSize: 14 }}>Sin comentarios.</Text>}
            <Campo value={texto} onChangeText={setTexto} placeholder="Escribe un comentario…" maxLength={2000} />
            <BotonGrande texto="Comentar" onPress={mandarComentario} deshabilitado={ocupado || !texto.trim()} />
          </Seccion>
          {pieza.promocion_id ? (
            <Seccion titulo="Ventas de la promoción">
              {!vEfecto && !efecto ? <BotonGrande texto="Medir" borde color={MARCA.azulClaro} onPress={medir} /> : null}
              {efecto?.pendiente ? <Text style={{ color: colorSistema.texto2, fontSize: 14 }}>{`Se puede medir desde el ${fechaTexto(efecto.desde, { day: 'numeric', month: 'long' })}.`}</Text> : null}
              {efecto?.sin_productos || efecto?.vacio ? <Text style={{ color: colorSistema.texto2, fontSize: 14 }}>La promoción no tiene productos para comparar.</Text> : null}
              {vEfecto ? (
                <>
                  <Text style={{ color: colorSistema.texto, fontSize: 18, fontWeight: '800' }}>
                    {`${formatMoney(vEfecto.durante)}${vEfecto.pct != null ? ` · ${vEfecto.pct >= 0 ? '+' : ''}${formatPct(vEfecto.pct, { decimales: 0 })}` : ' · sin ventas antes'}`}
                  </Text>
                  <Text style={{ color: colorSistema.texto2, fontSize: 13 }}>
                    {`${efecto.dias} días desde el ${fechaTexto(efecto.desde, { day: 'numeric', month: 'short' })}: ${formatQty(vEfecto.unidadesDurante)} unidades, contra ${formatMoney(vEfecto.antes)} (${formatQty(vEfecto.unidadesAntes)} unidades) los ${efecto.dias} días anteriores. Es una referencia: la temporada y el inventario también mueven la venta.`}
                  </Text>
                </>
              ) : null}
            </Seccion>
          ) : null}
          {sePuedeLiberar ? (
            <Seccion titulo="Para las salas" pie={pieza.liberada ? 'Las salas la ven en Galería y la pueden descargar para publicarla en WhatsApp.' : 'Al liberarla, las salas la ven en Galería y la pueden descargar.'}>
              <BotonGrande texto={pieza.liberada ? 'Retener (dejar de mostrarla)' : 'Liberar para las salas'} color={pieza.liberada ? MARCA.ambar : MARCA.verde} borde={!!pieza.liberada} deshabilitado={ocupado} onPress={() => liberar(!pieza.liberada)} />
              {(pieza.archivos || []).filter((a) => a.url && !a.reemplazado).map((a) => {
                const w = aptoParaWhatsApp(a);
                return <Text key={a.id ?? a.url} style={{ color: w.apto ? MARCA.verde : MARCA.ambar, fontSize: 12 }}>{`${a.nombre || 'Diseño'}: ${w.apto ? (w.vertical === false ? 'sirve para WhatsApp, pero no es vertical' : 'listo para WhatsApp') : w.motivo}`}</Text>;
              })}
            </Seccion>
          ) : null}
          {puedeEditar ? (
            <Seccion titulo="Diseñador">
              <BotonGrande borde texto="Agregar un enlace (Drive, Canva)" color={MARCA.azulClaro} onPress={enlace} deshabilitado={ocupado} />
              <BotonGrande texto="Editar la pieza y sus diseños" onPress={() => router.push('/marketing-editar')} />
              <BotonGrande borde texto={pieza?.pauta ? 'La pauta' : 'Pautarla'} color={MARCA.azulClaro} onPress={() => router.push('/marketing-pauta')} />
              <BotonGrande borde texto="Duplicar a otro mes" color={MARCA.azulClaro} onPress={duplicar} />
              {puedeQuitar ? <BotonGrande borde texto="Quitar la pieza" color={MARCA.rojo} onPress={quitar} deshabilitado={ocupado} /> : null}
            </Seccion>
          ) : null}
        </ScrollView>
      </KeyboardAvoidingView>
    </>
  );
}
