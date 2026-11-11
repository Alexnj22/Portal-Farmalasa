// Mis tratamientos (2026-10-07): lo que el cliente compra con regularidad, con
// cuándo se le acaba. «Reservar» lleva al producto; «Ya no lo tomo» apaga el
// recordatorio con un motivo (si vuelve a comprarlo, se reactiva solo).
// «Recordarme tomarlo» (2026-10-12): avisos de cada toma, sólo en el teléfono
// (lib/tomas.js, componentes/TomasHoja.js). En la web no aparece.
// «Volver a pedir» (2026-10-15): reemplaza a «Reservar». Un toque pone el
// medicamento en el carrito —en la presentación y cantidad de la última
// compra— y lo abre (componentes/VolverAPedir). La ficha del producto se abre
// tocando su nombre.
// Dosis (2026-10-29): «Recordarme tomarlo» manda cuánto toma al día y la fecha
// en que se acaba sale de ahí; al cerrar la hoja se vuelve a pedir la lista.
// «Agregar un medicamento que tomo» (2026-10-29, componentes/
// AgregarTratamientoHoja): lo que la lista automática no ve. Los que agregó el
// cliente se quitan con «Quitar de mi lista» en vez de «Ya no lo tomo».
// De vuelta a la tarjeta original (2026-11-04, usuario: «me gustaba más la
// card que había antes, la primera, y no estas 2 reediciones»). Los dos
// rediseños de ese día —tarjeta con barra y «⋯», y lista agrupada con «Hoy»—
// se deshicieron. Se quedan dos cosas que pidió aparte: tocar el nombre abre
// el RECORDATORIO y no el producto («al tocar me lleva a comprar el producto,
// no al recordatorio»), y al agregar un medicamento se puede pasar directo a
// «Recordarme tomarlo».
import { useCallback, useState } from 'react';
import { ActionSheetIOS, Alert, Platform, ScrollView, Text, View } from 'react-native';
import Presionable from '../componentes/Presionable';
import { useFocusEffect } from 'expo-router';
import * as Haptics from 'expo-haptics';
import { Cargando, Pantalla, Seccion, Tarjeta, Vacio } from '../componentes/ui';
import { colorSistema } from '../componentes/sistema';
import Icono from '../componentes/Icono';
import { useSesion } from '../lib/sesion';
import { useCuenta } from '../lib/cuenta';
import { fecha, nombrePropio } from '../lib/formato';
import { navegar } from '../lib/navegar';
import { suave, useTema } from '../tema/tema';
import TomasHoja from '../componentes/TomasHoja';
import AgregarTratamientoHoja from '../componentes/AgregarTratamientoHoja';
import { DISPONIBLE as TOMAS, marcarTomado, quitarRecordatorio, resumenRecordatorio, sincronizarConTratamientos, tomasDeHoy, useTomas } from '../lib/tomas';
import { copiaParaEmpezar } from '../lib/sinConexion';
import { useVolverAPedir } from '../componentes/VolverAPedir';

const MOTIVOS = ['Terminé el tratamiento', 'El médico me lo cambió', 'Lo compro en otro lugar', 'Otro motivo'];
const hoySV = () => new Date(Date.now() - 6 * 3600_000).toISOString().slice(0, 10);
const diasHasta = (f) => Math.round((Date.parse(`${f}T12:00:00Z`) - Date.parse(`${hoySV()}T12:00:00Z`)) / 86400_000);

export default function Tratamientos() {
  const pedir = useSesion((s) => s.pedir);
  const [d, setD] = useState(null);
  const [refrescando, setRefrescando] = useState(false);
  const preRegistro = useCuenta((s) => !!s.resumen?.pendiente);
  const [tomas, setTomas] = useState(null); // el tratamiento cuya hoja de tomas está abierta
  const [agregando, setAgregando] = useState(false);
  const { volver, ocupado } = useVolverAPedir();
  const [volviendo, setVolviendo] = useState(null); // cuál está esperando al servidor
  const volverAPedir = async (t) => { setVolviendo(t.id); await volver({ productos: [t.product_id] }); setVolviendo(null); };
  const cargar = useCallback(async () => {
    // Lo de la vez anterior se pinta al instante mientras llega lo fresco (2026-10-14).
    copiaParaEmpezar('mis_tratamientos', {}).then((c) => { if (c) setD((a) => a ?? c); });
    const r = await pedir('mis_tratamientos');
    setD((a) => (r?.ok || !a?.ok ? r : a));
    // Cuándo se le acaba cada uno, para el «Te quedan pocas» del aviso de toma.
    if (r?.ok) sincronizarConTratamientos(r.tratamientos);
    return r;
  }, [pedir]);
  // Recién agregado y con «Recordarme tomarlo» pedido: su hoja se abre cuando
  // la de agregar terminó de irse (iOS no presenta una hoja mientras otra se va).
  const alCerrarAgregar = async (agrego, recordar) => {
    setAgregando(false);
    if (!agrego) return;
    const r = await cargar();
    const t = recordar && r?.ok ? r.tratamientos.find((x) => String(x.product_id) === String(recordar)) : null;
    if (t) setTimeout(() => setTomas(t), 450);
  };
  useFocusEffect(useCallback(() => { cargar(); }, [cargar]));
  const refrescar = async () => { setRefrescando(true); await cargar(); setRefrescando(false); };

  const cambiar = async (t, activo, motivo) => {
    const r = await pedir('tratamiento_cambiar', { id: t.id, activo, motivo });
    if (!r?.ok) { Alert.alert('No se pudo guardar', r?.mensaje ?? 'Revisa tu conexión.'); return; }
    Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success).catch(() => {});
    // «Ya no lo tomo» también apaga los avisos de cada toma.
    if (!activo) quitarRecordatorio(String(t.product_id));
    cargar();
  };
  // Lo que agregó el cliente se borra: no vuelve solo con la próxima compra.
  const quitarDeLaLista = (t) => Alert.alert('Quitar de mi lista', `Dejamos de avisarte de ${nombrePropio(t.nombre)}.`, [
    { text: 'Cancelar', style: 'cancel' },
    { text: 'Quitar', style: 'destructive', onPress: async () => {
      const r = await pedir('tratamiento_quitar', { id: t.id });
      if (!r?.ok) { Alert.alert('No se pudo quitar', r?.mensaje ?? 'Revisa tu conexión.'); return; }
      quitarRecordatorio(String(t.product_id));
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success).catch(() => {});
      cargar();
    } },
  ]);
  const asignar = async (t, familiarId) => {
    Haptics.selectionAsync().catch(() => {});
    setD((a) => ({ ...a, tratamientos: a.tratamientos.map((x) => (x.id === t.id ? { ...x, familiar_id: familiarId } : x)) }));
    const r = await pedir('tratamiento_asignar', { id: t.id, familiar_id: familiarId });
    if (!r?.ok) { Alert.alert('No se pudo guardar', r?.mensaje ?? 'Revisa tu conexión.'); cargar(); }
  };
  const yaNo = (t) => {
    const elegir = (i) => {
      if (i == null || i >= MOTIVOS.length) return;
      if (MOTIVOS[i] === 'Otro motivo' && Platform.OS !== 'web') {
        Alert.prompt('¿Por qué ya no lo tomas?', 'Nos ayuda a no molestarte.', [
          { text: 'Cancelar', style: 'cancel' },
          { text: 'Guardar', onPress: (x) => cambiar(t, false, (x ?? '').trim() || 'Otro motivo') },
        ]);
        return;
      }
      cambiar(t, false, MOTIVOS[i]);
    };
    // En Android, la hoja de componentes/HojasAndroid: su alerta dibuja sólo
    // tres botones y los motivos son cuatro más «Cancelar».
    if (Platform.OS !== 'web') {
      ActionSheetIOS.showActionSheetWithOptions({ title: 'Ya no lo tomo', message: 'Dejamos de recordártelo. ¿Por qué?',
        options: [...MOTIVOS, 'Cancelar'], cancelButtonIndex: MOTIVOS.length }, elegir);
    } else {
      Alert.alert('Ya no lo tomo', '¿Por qué?', [...MOTIVOS.map((m, i) => ({ text: m, onPress: () => elegir(i) })), { text: 'Cancelar', style: 'cancel' }]);
    }
  };

  if (!d) return <Cargando />;
  // Sin ficha todavía: se explica por qué no hay nada (2026-10-12). Antes salía
  // como lista vacía, o con el mensaje de reservar.
  if (d.pendiente || (!d.ok && preRegistro)) {
    return <Pantalla conPestanas={false}><Vacio titulo="Aún no hay recordatorios" icono="pills.fill" respaldo="✚">Cuando completes tu registro en cualquier sucursal verás aquí lo que compras con regularidad.</Vacio></Pantalla>;
  }
  // Un error no es «no hay recordatorios» (2026-10-12): se dice y se reintenta.
  if (!d.ok) {
    return (
      <Pantalla conPestanas={false} alRefrescar={refrescar} refrescando={refrescando}>
        <Vacio titulo="No se pudieron cargar">{d.mensaje ?? 'Revisa tu conexión e intenta de nuevo.'}</Vacio>
        <Reintentar alTocar={refrescar} />
      </Pantalla>
    );
  }
  const activos = d.ok ? d.tratamientos.filter((t) => t.estado === 'activo') : [];
  const apagados = d.ok ? d.tratamientos.filter((t) => t.estado !== 'activo') : [];
  return (
    <Pantalla sinVidrio conPestanas={false} alRefrescar={refrescar} refrescando={refrescando}>
      <Text style={{ fontSize: 15, color: colorSistema.texto2 }}>
        Lo que compras con regularidad. Te avisamos unos días antes de que se te acabe.
      </Text>
      {!activos.length && !apagados.length ? (
        <Vacio titulo="Aún no hay recordatorios" icono="pills.fill" respaldo="✚">Cuando compres un medicamento con regularidad, aparecerá aquí. Si tomas uno que no aparece, agrégalo.</Vacio>
      ) : null}
      <View style={{ flexDirection: 'row' }}><Boton texto="Agregar un medicamento que tomo" sf="plus" alTocar={() => setAgregando(true)} /></View>
      {/* «Que salga agregar a alguien de la familia» (2026-11-11): antes sólo se
          llegaba a Mi familia desde Cuenta, y sin nadie agregado aquí no había
          rastro de que se pudiera. */}
      {d.familia_abierta ? (
        <View style={{ flexDirection: 'row' }}>
          <Boton texto={d.familiares?.length ? 'Mi familia: agregar o quitar' : 'Agregar a alguien de tu familia'} sf="person.3.fill" alTocar={() => navegar('/familia')} />
        </View>
      ) : null}
      {activos.map((t) => <Fila key={t.id} t={t} familiares={d.familiares} alAsignar={asignar} alVer={() => (TOMAS ? setTomas(t) : navegar(`/producto/${t.product_id}`))} alVolver={() => volverAPedir(t)}
        volviendo={ocupado && volviendo === t.id} alApagar={() => yaNo(t)} alRecordar={() => setTomas(t)}
        alPreguntar={() => navegar(`/chat?producto=${t.product_id}`)} alQuitarDeLaLista={t.origen === 'cliente' ? () => quitarDeLaLista(t) : undefined} />)}
      {apagados.length ? <Seccion estilo={{ marginTop: 8 }}>Ya no lo tomo</Seccion> : null}
      {apagados.map((t) => <Fila key={t.id} t={t} apagado alEncender={() => cambiar(t, true, null)} />)}
      {agregando ? <AgregarTratamientoHoja alCerrar={alCerrarAgregar} /> : null}
      {tomas ? <TomasHoja tratamiento={tomas} actual={useTomas.getState().config[String(tomas.product_id)]} alCerrar={() => { setTomas(null); cargar(); }} /> : null}
    </Pantalla>
  );
}

function Fila({ t, familiares = [], alAsignar, apagado, alVer, alVolver, volviendo, alApagar, alEncender, alRecordar, alPreguntar, alQuitarDeLaLista }) {
  const tema = useTema();
  const pid = String(t.product_id);
  const recordatorio = useTomas((s) => s.config[pid]);
  // El registro entero y no un arreglo armado en el selector: zustand
  // compara por identidad y un arreglo nuevo en cada lectura re-renderiza sin fin.
  const registro = useTomas((s) => s.registro);
  const hoy = recordatorio ? tomasDeHoy(registro, pid) : [];
  // Cuántas tocan hoy: las horas del recordatorio (sin repetidas).
  const tocan = recordatorio ? new Set(recordatorio.horas ?? []).size || 1 : 0;
  const completo = tocan > 0 && hoy.length >= tocan;
  const tomar = () => { Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success).catch(() => {}); marcarTomado(pid); };
  // `se_acaba` puede venir vacío (la columna lo admite): sin fecha no se
  // inventa «en NaN días», simplemente no se dice.
  const dias = t.se_acaba ? diasHasta(t.se_acaba) : null;
  const urgente = !apagado && dias != null && dias <= 3;
  const cuando = dias == null ? null : dias < 0 ? `Se te acabó hace ${-dias} día${dias === -1 ? '' : 's'}` : dias === 0 ? 'Se te acaba hoy' : `Se te acaba en ${dias} día${dias === 1 ? '' : 's'}`;
  const color = urgente ? tema.color.magenta : tema.color.verde;
  return (
    <Tarjeta estilo={{ gap: 12, opacity: apagado ? 0.65 : 1 }}>
      {/* De quién es (2026-11-09): sólo con «Mi familia» abierta y alguien agregado. */}
      {familiares.length && alAsignar ? (
        <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: 6 }}>
          {[{ id: null, nombre: 'Para mí' }, ...familiares].map((f) => {
            const si = (t.familiar_id ?? null) === f.id;
            return (
              <Presionable key={f.id ?? 'yo'} onPress={() => alAsignar(t, f.id)} accessibilityRole="button" accessibilityState={{ selected: si }}
                style={{ minHeight: 44, justifyContent: 'center', paddingHorizontal: 12, borderRadius: 999, backgroundColor: si ? tema.color.magenta : suave(tema.color.magenta, tema.oscuro ? 0.22 : 0.1) }}>
                <Text style={{ fontSize: 13, fontWeight: '700', color: si ? '#FFFFFF' : tema.color.magentaTexto }}>{f.nombre}</Text>
              </Presionable>
            );
          })}
        </ScrollView>
      ) : null}
      <View style={{ flexDirection: 'row', gap: 12, alignItems: 'center' }}>
        <View style={{ width: 42, height: 42, borderRadius: 13, alignItems: 'center', justifyContent: 'center', backgroundColor: suave(color, tema.oscuro ? 0.26 : 0.15) }}>
          <Icono sf="pills.fill" respaldo="💊" tam={19} color={urgente ? tema.color.magentaTexto : tema.color.verdeTexto} />
        </View>
        <Presionable onPress={alVer ? () => { Haptics.selectionAsync().catch(() => {}); alVer(); } : undefined} disabled={!alVer}
          accessibilityRole={alVer ? 'button' : undefined} accessibilityHint={alVer ? (TOMAS ? 'Abre el recordatorio de tomas' : 'Abre el producto') : undefined} style={{ flex: 1, gap: 2 }}>
          <Text style={{ fontSize: 15, fontWeight: '700', color: colorSistema.texto }}>{nombrePropio(t.nombre)}</Text>
          <Text style={{ fontSize: 13, color: colorSistema.texto2 }}>
            {apagado ? t.motivo : t.origen === 'cliente' ? (t.veces === 0 ? `Agregado por ti · desde ${fecha(t.ultima)}` : `Agregado por ti · última compra ${fecha(t.ultima)}`) : `Cada ${t.intervalo} días · última compra ${fecha(t.ultima)}`}
          </Text>
          {!apagado && cuando ? <Text style={{ fontSize: 13, fontWeight: '700', color: urgente ? tema.color.magentaTexto : colorSistema.texto2 }}>{cuando}</Text> : null}
        </Presionable>
        {/* Preguntar a la farmacia por este medicamento (2026-10-13): abre el chat con él puesto. */}
        {alPreguntar ? (
          <Presionable onPress={() => { Haptics.selectionAsync().catch(() => {}); alPreguntar(); }} accessibilityRole="button"
            accessibilityLabel={`Preguntar a la farmacia por ${nombrePropio(t.nombre)}`} hitSlop={4}
            style={({ pressed }) => ({ width: 44, height: 44, borderRadius: 22, alignItems: 'center', justifyContent: 'center',
              backgroundColor: suave(tema.color.magenta, pressed ? 0.3 : (tema.oscuro ? 0.22 : 0.12)) })}>
            <Icono sf="bubble.left.and.bubble.right.fill" respaldo="💬" tam={18} color={tema.color.magentaTexto} />
          </Presionable>
        ) : null}
      </View>
      <View style={{ flexDirection: 'row', gap: 8 }}>
        {apagado ? <Boton texto="Volver a recordarme" alTocar={alEncender} /> : (
          <>
            <Boton texto={volviendo ? 'Agregando…' : 'Volver a pedir'} sf="arrow.clockwise" principal alTocar={alVolver} deshabilitado={volviendo} />
            {alQuitarDeLaLista ? <Boton texto="Quitar de mi lista" alTocar={alQuitarDeLaLista} /> : <Boton texto="Ya no lo tomo" alTocar={alApagar} />}
          </>
        )}
      </View>
      {!apagado && TOMAS ? (recordatorio ? (
        <View style={{ gap: 8, borderRadius: 12, padding: 12, backgroundColor: tema.oscuro ? 'rgba(255,255,255,0.06)' : 'rgba(0,0,0,0.035)' }}>
          <View style={{ flexDirection: 'row', gap: 8, alignItems: 'flex-start' }}>
            <Icono sf="bell.fill" respaldo="🔔" tam={14} color={tema.color.magentaTexto} />
            <View style={{ flex: 1, gap: 2 }}>
              <Text style={{ fontSize: 13, fontWeight: '600', color: colorSistema.texto }}>{resumenRecordatorio(recordatorio)}</Text>
              {recordatorio.nota ? <Text style={{ fontSize: 13, color: colorSistema.texto2 }}>{recordatorio.nota}</Text> : null}
              {hoy.length ? (
                <Text style={{ fontSize: 13, fontWeight: '600', color: tema.color.verdeTexto }}>
                  {tocan > 1 ? `Hoy ${Math.min(hoy.length, tocan)} de ${tocan} · última a las ${hoy[hoy.length - 1]}` : `Tomado hoy a las ${hoy[hoy.length - 1]}`}
                </Text>
              ) : null}
            </View>
          </View>
          <View style={{ flexDirection: 'row', gap: 8 }}>
            {/* «Lo tomé» (2026-11-04) en lugar de «Quitar recordatorio», que
                sigue dentro de «Editar»: la tarjeta tenía cinco botones y
                ninguno servía para lo que más se hace cada día. */}
            <Boton texto={completo ? 'Listo por hoy' : 'Lo tomé'} sf={completo ? 'checkmark' : 'checkmark.circle'} alTocar={tomar} deshabilitado={completo} />
            <Boton texto="Editar" alTocar={alRecordar} />
          </View>
        </View>
      ) : (
        <View style={{ flexDirection: 'row' }}><Boton texto="Recordarme tomarlo" alTocar={alRecordar} /></View>
      )) : null}
    </Tarjeta>
  );
}

function Reintentar({ alTocar }) {
  const t = useTema();
  return (
    <Presionable onPress={alTocar} accessibilityRole="button" hitSlop={8} style={{ alignSelf: 'center', minHeight: 44, justifyContent: 'center', paddingHorizontal: 14 }}>
      <Text style={{ fontSize: 17, fontWeight: '700', color: t.color.magentaTexto }}>Reintentar</Text>
    </Presionable>
  );
}

function Boton({ texto, alTocar, principal, sf, deshabilitado }) {
  const t = useTema();
  return (
    <Presionable onPress={() => { if (deshabilitado) return; Haptics.selectionAsync().catch(() => {}); alTocar(); }} accessibilityRole="button"
      disabled={!!deshabilitado} accessibilityState={{ disabled: !!deshabilitado }}
      style={({ pressed }) => ({ flex: 1, minHeight: 44, borderRadius: 12, alignItems: 'center', justifyContent: 'center', flexDirection: 'row', gap: 6, paddingHorizontal: 8, paddingVertical: 6,
        opacity: deshabilitado ? 0.7 : 1,
        backgroundColor: principal ? t.color.magenta : (t.oscuro ? 'rgba(255,255,255,0.08)' : 'rgba(0,0,0,0.05)'), transform: [{ scale: pressed ? 0.96 : 1 }] })}>
      {sf ? <Icono sf={sf} respaldo="" tam={13} color={principal ? '#FFFFFF' : colorSistema.texto} /> : null}
      <Text style={{ flexShrink: 1, textAlign: 'center', fontSize: 14, fontWeight: '700', color: principal ? '#FFFFFF' : colorSistema.texto }}>{texto}</Text>
    </Presionable>
  );
}
