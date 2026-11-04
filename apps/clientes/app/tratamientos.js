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
// Rediseño de la tarjeta (2026-11-04): el color dice cuánto falta (verde,
// naranja a 7 días o menos, rojo si se acabó) con una barra de lo que queda;
// UN botón principal («Volver a pedir») y lo demás —ver el producto,
// preguntar, ya no lo tomo— en el menú «⋯», como en las listas del sistema.
// «Agregar» pasa al «+» de la barra. El recordatorio lleva un punto por toma
// de hoy y «Lo tomé».
import { useCallback, useState } from 'react';
import { ActionSheetIOS, Alert, Platform, Text, View } from 'react-native';
import Presionable from '../componentes/Presionable';
import { Stack, useFocusEffect } from 'expo-router';
import * as Haptics from 'expo-haptics';
import { Cargando, Pantalla, Seccion, Tarjeta, Vacio } from '../componentes/ui';
import { colorSistema } from '../componentes/sistema';
import { hojaDeOpciones } from '../componentes/BandejaAvisos';
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
  const tema = useTema();
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
  // Recién agregado y con «Recordarme tomarlo» pedido: se abre su hoja cuando
  // la de agregar terminó de cerrarse (iOS no presenta una hoja mientras otra
  // se está yendo).
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
  const vacio = !activos.length && !apagados.length;
  const menu = (t) => {
    const nombre = nombrePropio(t.nombre);
    const opciones = [
      { texto: 'Ver el producto', alElegir: () => navegar(`/producto/${t.product_id}`) },
      { texto: 'Preguntar a la farmacia', alElegir: () => navegar(`/chat?producto=${t.product_id}`) },
      t.origen === 'cliente'
        ? { texto: 'Quitar de mi lista', destructivo: true, alElegir: () => quitarDeLaLista(t) }
        : { texto: 'Ya no lo tomo', destructivo: true, alElegir: () => yaNo(t) },
    ];
    if (Platform.OS === 'web') {
      Alert.alert(nombre, undefined, [...opciones.map((o) => ({ text: o.texto, style: o.destructivo ? 'destructive' : 'default', onPress: o.alElegir })), { text: 'Cancelar', style: 'cancel' }]);
      return;
    }
    hojaDeOpciones({ titulo: nombre, opciones });
  };
  return (
    <Pantalla sinVidrio conPestanas={false} alRefrescar={refrescar} refrescando={refrescando}>
      <Stack.Screen options={{
        headerRight: () => (
          <Presionable onPress={() => { Haptics.selectionAsync().catch(() => {}); setAgregando(true); }} hitSlop={10}
            accessibilityRole="button" accessibilityLabel="Agregar un medicamento que tomo"
            style={({ pressed }) => ({ minHeight: 44, minWidth: 44, alignItems: 'center', justifyContent: 'center', opacity: pressed ? 0.5 : 1 })}>
            <Icono sf="plus" respaldo="+" tam={Platform.OS === 'android' ? 24 : 20} color={Platform.OS === 'android' ? colorSistema.texto : tema.color.magentaTexto} />
          </Presionable>
        ),
      }} />
      <Text style={{ fontSize: 15, lineHeight: 21, color: colorSistema.texto2 }}>
        Lo que compras con regularidad. Te avisamos unos días antes de que se te acabe.
      </Text>
      {vacio ? (
        <Vacio titulo="Aún no hay recordatorios" icono="pills.fill" respaldo="✚" accion="Agregar un medicamento" alAccion={() => setAgregando(true)}>
          Cuando compres un medicamento con regularidad, aparecerá aquí. Si tomas uno que no aparece, agrégalo.
        </Vacio>
      ) : null}
      {activos.map((t) => <Fila key={t.id} t={t} alVer={() => navegar(`/producto/${t.product_id}`)} alVolver={() => volverAPedir(t)}
        volviendo={ocupado && volviendo === t.id} alRecordar={() => setTomas(t)} alMenu={() => menu(t)} />)}
      {apagados.length ? <Seccion estilo={{ marginTop: 8 }}>Ya no lo tomo</Seccion> : null}
      {apagados.map((t) => <Fila key={t.id} t={t} apagado alEncender={() => cambiar(t, true, null)} />)}
      {/* Además del «+» de arriba: quien no lo ve, lo encuentra al final. */}
      {!vacio ? (
        <Presionable onPress={() => { Haptics.selectionAsync().catch(() => {}); setAgregando(true); }} accessibilityRole="button"
          style={({ pressed }) => ({ flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8, minHeight: 48, borderRadius: 14,
            borderWidth: 1.5, borderStyle: 'dashed', borderColor: suave(tema.color.magenta, 0.45), opacity: pressed ? 0.6 : 1 })}>
          <Icono sf="plus.circle.fill" respaldo="+" tam={16} color={tema.color.magentaTexto} />
          <Text style={{ fontSize: 15, fontWeight: '700', color: tema.color.magentaTexto }}>Agregar un medicamento que tomo</Text>
        </Presionable>
      ) : null}
      {agregando ? <AgregarTratamientoHoja alCerrar={alCerrarAgregar} /> : null}
      {tomas ? <TomasHoja tratamiento={tomas} actual={useTomas.getState().config[String(tomas.product_id)]} alCerrar={() => { setTomas(null); cargar(); }} /> : null}
    </Pantalla>
  );
}

// El estado de una tarjeta por los días que faltan: verde, naranja (7 días o
// menos) o rojo (hoy o ya pasó). Sin fecha, verde y sin barra.
function estadoDe(tema, dias) {
  if (dias == null || dias > 7) return { fondo: tema.color.verde, texto: tema.color.verdeTexto, pronto: false };
  if (dias > 0) return { fondo: tema.color.aviso, texto: tema.color.avisoTexto, pronto: true };
  return { fondo: tema.color.peligro, texto: tema.color.peligroTexto, pronto: true };
}

function Fila({ t, apagado, alVer, alVolver, volviendo, alEncender, alRecordar, alMenu }) {
  const tema = useTema();
  const pid = String(t.product_id);
  const recordatorio = useTomas((s) => s.config[pid]);
  // El registro entero y no un arreglo armado en el selector: zustand
  // compara por identidad y un arreglo nuevo en cada lectura re-renderiza sin fin.
  const registro = useTomas((s) => s.registro);
  const hoy = recordatorio ? tomasDeHoy(registro, pid) : [];
  // Cuántas tocan hoy: las horas del recordatorio (sin repetidas).
  const tocan = recordatorio ? new Set(recordatorio.horas ?? []).size || 1 : 0;
  const hechas = Math.min(hoy.length, tocan);
  const completo = tocan > 0 && hechas >= tocan;
  const tomar = () => { Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success).catch(() => {}); marcarTomado(pid); };
  // `se_acaba` puede venir vacío (la columna lo admite): sin fecha no se
  // inventa «en NaN días», simplemente no se dice.
  const dias = t.se_acaba ? diasHasta(t.se_acaba) : null;
  const estado = estadoDe(tema, apagado ? null : dias);
  const cuando = dias == null ? null : dias < 0 ? `Se te acabó hace ${-dias} día${dias === -1 ? '' : 's'}` : dias === 0 ? 'Se te acaba hoy' : `Se te acaba en ${dias} día${dias === 1 ? '' : 's'}`;
  // Lo que queda de lo comprado, sobre lo que dura una compra.
  const periodo = Number(t.intervalo || t.dura_cliente) || null;
  const queda = periodo && dias != null ? Math.max(0, Math.min(1, dias / periodo)) : null;
  const pista = tema.oscuro ? 'rgba(255,255,255,0.10)' : 'rgba(0,0,0,0.07)';
  const nombre = nombrePropio(t.nombre);

  if (apagado) {
    return (
      <Tarjeta estilo={{ gap: 12 }}>
        <View style={{ flexDirection: 'row', gap: 12, alignItems: 'center' }}>
          <View style={{ width: 44, height: 44, borderRadius: 14, alignItems: 'center', justifyContent: 'center', backgroundColor: pista }}>
            <Icono sf="pills" respaldo="💊" tam={19} color={colorSistema.texto3} />
          </View>
          <View style={{ flex: 1, gap: 2 }}>
            <Text style={{ fontSize: 15, fontWeight: '700', color: colorSistema.texto2 }}>{nombre}</Text>
            {t.motivo ? <Text style={{ fontSize: 13, color: colorSistema.texto3 }}>{t.motivo}</Text> : null}
          </View>
        </View>
        <View style={{ flexDirection: 'row' }}><Boton texto="Volver a recordarme" sf="bell" alTocar={alEncender} /></View>
      </Tarjeta>
    );
  }

  return (
    <Tarjeta estilo={{ gap: 12 }}>
      <View style={{ flexDirection: 'row', gap: 12, alignItems: 'flex-start' }}>
        <View style={{ width: 44, height: 44, borderRadius: 14, alignItems: 'center', justifyContent: 'center', backgroundColor: suave(estado.fondo, tema.oscuro ? 0.26 : 0.15) }}>
          <Icono sf="pills.fill" respaldo="💊" tam={20} color={estado.texto} />
        </View>
        <Presionable onPress={() => { Haptics.selectionAsync().catch(() => {}); alVer(); }}
          accessibilityRole="link" accessibilityHint="Abre el producto" style={{ flex: 1, gap: 2, minHeight: 44, justifyContent: 'center' }}>
          <Text style={{ fontSize: 16, fontWeight: '700', color: colorSistema.texto }}>{nombre}</Text>
          <Text style={{ fontSize: 13, color: colorSistema.texto2 }}>
            {t.origen === 'cliente' ? `Agregado por ti · última compra ${fecha(t.ultima)}` : `Cada ${t.intervalo} días · última compra ${fecha(t.ultima)}`}
          </Text>
        </Presionable>
        {/* 36 de lado + 6 de `hitSlop` por lado = 48 pt de dedo. */}
        <Presionable onPress={() => { Haptics.selectionAsync().catch(() => {}); alMenu(); }} hitSlop={6}
          accessibilityRole="button" accessibilityLabel={`Más opciones de ${nombre}`}
          style={({ pressed }) => ({ width: 36, height: 36, borderRadius: 18, alignItems: 'center', justifyContent: 'center', backgroundColor: pressed ? pista : 'transparent' })}>
          <Icono sf="ellipsis.circle" respaldo="⋯" tam={20} color={colorSistema.texto2} />
        </Presionable>
      </View>

      {cuando ? (
        <View style={{ gap: 6 }}>
          <View style={{ flexDirection: 'row', alignItems: 'baseline', justifyContent: 'space-between', gap: 8, flexWrap: 'wrap' }}>
            <Text style={{ fontSize: 14, fontWeight: '800', color: estado.pronto ? estado.texto : colorSistema.texto }}>{cuando}</Text>
            {dias > 0 ? <Text style={{ fontSize: 13, color: colorSistema.texto3 }}>{fecha(t.se_acaba)}</Text> : null}
          </View>
          {queda != null ? (
            <View accessibilityElementsHidden importantForAccessibility="no-hide-descendants"
              style={{ height: 6, borderRadius: 3, backgroundColor: pista, overflow: 'hidden' }}>
              <View style={{ width: `${Math.max(queda * 100, queda > 0 ? 4 : 0)}%`, height: '100%', borderRadius: 3, backgroundColor: estado.fondo }} />
            </View>
          ) : null}
        </View>
      ) : null}

      <View style={{ flexDirection: 'row', gap: 8 }}>
        <Boton texto={volviendo ? 'Agregando…' : 'Volver a pedir'} sf="arrow.clockwise" principal alTocar={alVolver} deshabilitado={volviendo} />
        {TOMAS && !recordatorio ? <Boton texto="Recordarme tomarlo" sf="bell" alTocar={alRecordar} /> : null}
      </View>

      {TOMAS && recordatorio ? (
        <View style={{ gap: 10, borderRadius: 14, padding: 12, backgroundColor: tema.oscuro ? 'rgba(255,255,255,0.06)' : 'rgba(0,0,0,0.035)' }}>
          <View style={{ flexDirection: 'row', gap: 8, alignItems: 'flex-start' }}>
            <Icono sf="bell.fill" respaldo="🔔" tam={14} color={tema.color.magentaTexto} />
            <View style={{ flex: 1, gap: 2 }}>
              <Text style={{ fontSize: 13, fontWeight: '600', color: colorSistema.texto }}>{resumenRecordatorio(recordatorio)}</Text>
              {recordatorio.nota ? <Text style={{ fontSize: 13, color: colorSistema.texto2 }}>{recordatorio.nota}</Text> : null}
            </View>
          </View>
          {/* Un punto por toma de hoy: lleno el que ya se tomó. */}
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}
            accessible accessibilityLabel={tocan > 1 ? `Hoy, ${hechas} de ${tocan} tomas` : hechas ? 'Hoy ya lo tomaste' : 'Hoy todavía no lo tomas'}>
            <View style={{ flexDirection: 'row', gap: 5 }}>
              {Array.from({ length: Math.min(tocan, 6) }, (_, i) => (
                <View key={i} style={{ width: 10, height: 10, borderRadius: 5, backgroundColor: i < hechas ? tema.color.verde : 'transparent',
                  borderWidth: i < hechas ? 0 : 1.5, borderColor: colorSistema.texto3 }} />
              ))}
            </View>
            <Text style={{ flexShrink: 1, fontSize: 13, fontWeight: '600', color: hechas ? tema.color.verdeTexto : colorSistema.texto2 }}>
              {hechas
                ? (tocan > 1 ? `Hoy ${hechas} de ${tocan} · última a las ${hoy[hoy.length - 1]}` : `Tomado hoy a las ${hoy[hoy.length - 1]}`)
                : 'Hoy todavía no'}
            </Text>
          </View>
          <View style={{ flexDirection: 'row', gap: 8 }}>
            <Boton texto={completo ? 'Listo por hoy' : 'Lo tomé'} sf="checkmark" verde alTocar={tomar} deshabilitado={completo} />
            <Boton texto="Editar" alTocar={alRecordar} />
          </View>
        </View>
      ) : null}
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

function Boton({ texto, alTocar, principal, verde, sf, deshabilitado }) {
  const t = useTema();
  const lleno = principal ? t.color.magenta : null;
  // «Lo tomé»: el verde de lo que se cumple, en tinte (no compite con «Volver a pedir»).
  const tinte = verde ? suave(t.color.verde, t.oscuro ? 0.24 : 0.16) : null;
  const tinta = principal ? '#FFFFFF' : verde ? t.color.verdeTexto : colorSistema.texto;
  return (
    <Presionable onPress={() => { if (deshabilitado) return; Haptics.selectionAsync().catch(() => {}); alTocar(); }} accessibilityRole="button"
      disabled={!!deshabilitado} accessibilityState={{ disabled: !!deshabilitado }}
      style={({ pressed }) => ({ flex: 1, minHeight: 44, borderRadius: 12, alignItems: 'center', justifyContent: 'center', flexDirection: 'row', gap: 6, paddingHorizontal: 8, paddingVertical: 6,
        opacity: deshabilitado ? 0.7 : 1,
        backgroundColor: lleno ?? tinte ?? (t.oscuro ? 'rgba(255,255,255,0.08)' : 'rgba(0,0,0,0.05)'), transform: [{ scale: pressed && !deshabilitado ? 0.96 : 1 }] })}>
      {sf ? <Icono sf={sf} respaldo="" tam={13} color={tinta} /> : null}
      <Text style={{ flexShrink: 1, textAlign: 'center', fontSize: 14, fontWeight: '700', color: tinta }}>{texto}</Text>
    </Presionable>
  );
}
