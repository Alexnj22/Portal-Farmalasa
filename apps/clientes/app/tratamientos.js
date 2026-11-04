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
// Lista del sistema (2026-11-04, usuario: «no me gusta… que sean más nativas,
// en iOS se ve mal, se ve barato… al tocar me lleva a comprar el producto, no
// al recordatorio»). Reemplaza las tarjetas de ese mismo día:
//   · «Hoy»: cada toma del día con «Tomar» / «Deshacer», como Medicamentos de
//     la app Salud. Es lo que se usa todos los días, por eso va arriba.
//   · «Mis medicamentos»: lista agrupada como Ajustes. Tocar la fila abre el
//     RECORDATORIO. El ícono de color dice cuánto falta; «Pedir» aparece sólo
//     a 7 días o menos; el resto (volver a pedir, ver el producto, preguntar,
//     ya no lo tomo) en el «⋯», el menú desplegable del sistema
//     (componentes/AccionesFila).
//   · «Agregar» es el «+» de la barra.
import { Children, isValidElement, useCallback, useState } from 'react';
import { ActionSheetIOS, Alert, Platform, StyleSheet, Text, View } from 'react-native';
import Presionable from '../componentes/Presionable';
import { Stack, useFocusEffect } from 'expo-router';
import * as Haptics from 'expo-haptics';
import { Cargando, Pantalla, Seccion, Vacio } from '../componentes/ui';
import Vidrio from '../componentes/Vidrio';
import { Capsula, MenuMas } from '../componentes/AccionesFila';
import { colorSistema } from '../componentes/sistema';
import Icono from '../componentes/Icono';
import { useSesion } from '../lib/sesion';
import { useCuenta } from '../lib/cuenta';
import { nombrePropio } from '../lib/formato';
import { cantidadDe } from '../lib/dosis';
import { navegar } from '../lib/navegar';
import { useTema } from '../tema/tema';
import TomasHoja from '../componentes/TomasHoja';
import AgregarTratamientoHoja from '../componentes/AgregarTratamientoHoja';
import { DISPONIBLE as TOMAS, desmarcarToma, horaTexto, marcarTomado, quitarRecordatorio, sincronizarConTratamientos, tomaDeHoy, tomasQueTocanHoy, useTomas } from '../lib/tomas';
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
  const activos = d.tratamientos.filter((t) => t.estado === 'activo');
  const apagados = d.tratamientos.filter((t) => t.estado !== 'activo');
  const vacio = !activos.length && !apagados.length;
  const porPid = Object.fromEntries(activos.map((t) => [String(t.product_id), t]));
  // Tocar la fila abre el recordatorio (usuario, 2026-11-04: «al tocar me
  // lleva a comprar el producto, no al recordatorio»). En la web no hay
  // recordatorios: ahí abre el producto.
  const abrir = (t) => (TOMAS ? setTomas(t) : navegar(`/producto/${t.product_id}`));
  const opcionesDe = (t) => [
    { texto: 'Volver a pedir', sf: 'arrow.clockwise', alElegir: () => volverAPedir(t) },
    ...(TOMAS ? [{ texto: 'Recordatorio de tomas', sf: 'bell', alElegir: () => setTomas(t) }] : []),
    { texto: 'Ver el producto', sf: 'info.circle', alElegir: () => navegar(`/producto/${t.product_id}`) },
    { texto: 'Preguntar a la farmacia', sf: 'bubble.left.and.bubble.right', alElegir: () => navegar(`/chat?producto=${t.product_id}`) },
    t.origen === 'cliente'
      ? { texto: 'Quitar de mi lista', sf: 'trash', destructivo: true, alElegir: () => quitarDeLaLista(t) }
      : { texto: 'Ya no lo tomo', sf: 'xmark.circle', destructivo: true, alElegir: () => yaNo(t) },
  ];
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
      {vacio ? (
        <Vacio titulo="Aún no hay recordatorios" icono="pills.fill" respaldo="✚" accion="Agregar un medicamento" alAccion={() => setAgregando(true)}>
          Cuando compres un medicamento con regularidad, aparecerá aquí. Si tomas uno que no aparece, agrégalo.
        </Vacio>
      ) : null}

      {TOMAS ? <Hoy porPid={porPid} alAbrir={(t) => setTomas(t)} /> : null}

      {activos.length ? (
        <Lista titulo="Mis medicamentos" pie={TOMAS
          ? 'Toca uno para que te recordemos cada toma. Te avisamos unos días antes de que se te acabe.'
          : 'Te avisamos unos días antes de que se te acabe.'}>
          {activos.map((t) => (
            <FilaMedicamento key={t.id} t={t} alTocar={() => abrir(t)} opciones={opcionesDe(t)}
              alPedir={() => volverAPedir(t)} pidiendo={ocupado && volviendo === t.id} />
          ))}
        </Lista>
      ) : null}

      {apagados.length ? (
        <Lista titulo="Ya no lo tomo" pie="Si lo vuelves a comprar, vuelve a aparecer arriba solo.">
          {apagados.map((t) => <FilaApagada key={t.id} t={t} alEncender={() => cambiar(t, true, null)} />)}
        </Lista>
      ) : null}

      {agregando ? <AgregarTratamientoHoja alCerrar={alCerrarAgregar} /> : null}
      {tomas ? <TomasHoja tratamiento={tomas} actual={useTomas.getState().config[String(tomas.product_id)]} alCerrar={() => { setTomas(null); cargar(); }} /> : null}
    </Pantalla>
  );
}

// ── La lista agrupada, como Ajustes y Salud ─────────────────────────────────
// Un grupo de filas sobre una sola superficie, con separadores que empiezan
// donde empieza el texto (no bajo el ícono), título arriba y pie abajo en gris.
// Es `Grupo` de componentes/sistema.js sin su margen propio: acá `Pantalla` ya
// pone el de los lados.
const ANCHO_ICONO = 32;
function Lista({ titulo, pie, children }) {
  const filas = Children.toArray(children).filter(isValidElement);
  return (
    <View>
      {titulo ? <Seccion estilo={{ marginLeft: 16, marginBottom: 6 }}>{titulo}</Seccion> : null}
      <Vidrio radio={Platform.OS === 'ios' ? 26 : 16}>
        {filas.map((fila, i) => (
          <View key={fila.key ?? i}>
            {fila}
            {i < filas.length - 1 ? <View style={{ height: StyleSheet.hairlineWidth, backgroundColor: colorSistema.separador, marginLeft: 16 + ANCHO_ICONO + 12 }} /> : null}
          </View>
        ))}
      </Vidrio>
      {pie ? <Text style={{ fontSize: 13, lineHeight: 18, color: colorSistema.texto2, marginHorizontal: 16, marginTop: 6 }}>{pie}</Text> : null}
    </View>
  );
}

// El estado por los días que faltan: verde, naranja (7 o menos) o rojo (hoy o
// ya pasó). Sin fecha, verde.
function estadoDe(tema, dias) {
  if (dias == null || dias > 7) return { color: tema.color.verde, texto: tema.color.verdeTexto, pronto: false };
  if (dias > 0) return { color: tema.color.aviso, texto: tema.color.avisoTexto, pronto: true };
  return { color: tema.color.peligro, texto: tema.color.peligroTexto, pronto: true };
}

// El ícono de la fila: cuadrado de color lleno con el glifo en blanco, como los
// de Ajustes. El color ES el estado.
function IconoFila({ color, sf = 'pills.fill', apagado }) {
  return (
    <View style={{ width: ANCHO_ICONO, height: ANCHO_ICONO, borderRadius: 8, alignItems: 'center', justifyContent: 'center',
      backgroundColor: apagado ? colorSistema.texto3 : color }}>
      <Icono sf={sf} respaldo="💊" tam={17} color="#FFFFFF" />
    </View>
  );
}

const textoCuando = (dias) => (dias == null ? null : dias < 0 ? `Se te acabó hace ${-dias} día${dias === -1 ? '' : 's'}`
  : dias === 0 ? 'Se te acaba hoy' : `Se te acaba en ${dias} día${dias === 1 ? '' : 's'}`);

function FilaMedicamento({ t, alTocar, opciones, alPedir, pidiendo }) {
  const tema = useTema();
  const pid = String(t.product_id);
  const recordatorio = useTomas((s) => s.config[pid]);
  const dias = t.se_acaba ? diasHasta(t.se_acaba) : null;
  const estado = estadoDe(tema, dias);
  const nombre = nombrePropio(t.nombre);
  const cuando = textoCuando(dias);
  // La segunda línea dice lo que más importa de un vistazo: a qué hora se toma
  // y cuánto, o que todavía no tiene recordatorio.
  const horario = recordatorio ? horarioCorto(recordatorio, t.nombre) : TOMAS ? 'Sin recordatorio de tomas' : `Cada ${t.intervalo ?? t.dura_cliente ?? '—'} días`;
  // La zona que abre el recordatorio y los botones van LADO A LADO, nunca uno
  // dentro del otro: un botón nativo dentro de un Presionable puede disparar
  // los dos con un solo toque.
  return (
    <View style={{ flexDirection: 'row', alignItems: 'center', paddingRight: 10 }}>
    <Presionable onPress={() => { Haptics.selectionAsync().catch(() => {}); alTocar(); }}
      accessibilityRole="button" accessibilityLabel={[nombre, horario, cuando].filter(Boolean).join('. ')}
      accessibilityHint={TOMAS ? 'Abre el recordatorio de tomas' : 'Abre el producto'}
      style={({ pressed }) => ({ flex: 1, flexDirection: 'row', alignItems: 'center', gap: 12, minHeight: 64, paddingLeft: 16, paddingRight: 8, paddingVertical: 10,
        opacity: pressed ? 0.55 : 1 })}>
      <IconoFila color={estado.color} />
      <View style={{ flex: 1, gap: 1 }}>
        <Text style={{ fontSize: 17, fontWeight: '600', color: colorSistema.texto }}>{nombre}</Text>
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 5 }}>
          {recordatorio ? <Icono sf="bell.fill" respaldo="" tam={11} color={colorSistema.texto2} /> : null}
          <Text style={{ flexShrink: 1, fontSize: 15, color: colorSistema.texto2 }}>{horario}</Text>
        </View>
        {cuando ? <Text style={{ fontSize: 13, fontWeight: estado.pronto ? '600' : '400', color: estado.pronto ? estado.texto : colorSistema.texto3 }}>{cuando}</Text> : null}
      </View>
    </Presionable>
      {/* «Pedir» sólo cuando hace falta; siempre está también en el menú. */}
      {estado.pronto ? <Capsula etiqueta={pidiendo ? '…' : 'Pedir'} alTocar={pidiendo ? () => {} : alPedir} color={tema.color.magenta} /> : null}
      <View style={{ width: 8 }} />
      <MenuMas opciones={opciones} etiqueta={`Más opciones de ${nombre}`} titulo={nombre} color={tema.color.magenta} />
    </View>
  );
}

function FilaApagada({ t, alEncender }) {
  const tema = useTema();
  const nombre = nombrePropio(t.nombre);
  return (
    <View style={{ flexDirection: 'row', alignItems: 'center', gap: 12, minHeight: 60, paddingLeft: 16, paddingRight: 12, paddingVertical: 10 }}
      accessible accessibilityLabel={[nombre, t.motivo].filter(Boolean).join('. ')}>
      <IconoFila apagado />
      <View style={{ flex: 1, gap: 1 }}>
        <Text style={{ fontSize: 17, color: colorSistema.texto2 }}>{nombre}</Text>
        {t.motivo ? <Text style={{ fontSize: 13, color: colorSistema.texto3 }}>{t.motivo}</Text> : null}
      </View>
      <Capsula etiqueta="Reactivar" alTocar={alEncender} color={tema.color.magenta} prominente={false} />
    </View>
  );
}

// «8:00 y 20:00 · 1 tableta»: lo del recordatorio en una línea corta (el
// resumen largo vive en la hoja).
function horarioCorto(c, nombreProd) {
  const horas = [...new Set(c.horas ?? [])].sort().map(horaTexto);
  const lista = horas.length < 3 ? horas.join(' y ') : `${horas.length} veces al día`;
  return c.cantidad ? `${lista} · ${cantidadDe(c.cantidad, nombreProd)}` : lista;
}

// ── Hoy: cada toma con su botón, como Medicamentos de la app Salud ──────────
function Hoy({ porPid, alAbrir }) {
  const tema = useTema();
  const config = useTomas((s) => s.config);
  const registro = useTomas((s) => s.registro);
  // Sólo lo que sigue en la lista: un recordatorio de algo que ya no está no se muestra.
  const tomas = tomasQueTocanHoy(config).filter((x) => porPid[x.pid]);
  if (!tomas.length) return null;
  const hechas = tomas.filter((x) => tomaDeHoy(registro, x.pid, x.hora)).length;
  const ahora = new Date();
  const minutosAhora = ahora.getHours() * 60 + ahora.getMinutes();
  const deshacer = (x, nombre) => Alert.alert('¿Desmarcar esta toma?', `${nombre}, ${horaTexto(x.hora)}.`, [
    { text: 'Cancelar', style: 'cancel' },
    { text: 'Desmarcar', style: 'destructive', onPress: () => desmarcarToma(x.pid, x.hora) },
  ]);
  return (
    <Lista titulo={`Hoy · ${hechas} de ${tomas.length}`}>
      {tomas.map((x) => {
        const t = porPid[x.pid];
        const nombre = nombrePropio(t.nombre);
        const hecha = tomaDeHoy(registro, x.pid, x.hora);
        const [hh, mm] = x.hora.split(':').map(Number);
        const tarde = !hecha && hh * 60 + mm < minutosAhora - 30;
        const detalle = [x.c.cantidad ? cantidadDe(x.c.cantidad, t.nombre) : null, x.c.nota || null].filter(Boolean).join(' · ');
        const cuando = hecha ? `Tomado a las ${horaDe(hecha.h)}` : tarde ? 'Pendiente' : null;
        return (
          <View key={`${x.pid}-${x.hora}`} style={{ flexDirection: 'row', alignItems: 'center', paddingRight: 12 }}>
          <Presionable onPress={() => { Haptics.selectionAsync().catch(() => {}); alAbrir(t); }}
            accessibilityRole="button" accessibilityLabel={[horaTexto(x.hora), nombre, detalle, cuando].filter(Boolean).join('. ')}
            accessibilityHint="Abre el recordatorio"
            style={({ pressed }) => ({ flex: 1, flexDirection: 'row', alignItems: 'center', gap: 12, minHeight: 60, paddingLeft: 16, paddingRight: 8, paddingVertical: 10,
              opacity: pressed ? 0.55 : 1 })}>
            <View style={{ width: ANCHO_ICONO, alignItems: 'center' }}>
              <Icono sf={hecha ? 'checkmark.circle.fill' : 'circle'} respaldo={hecha ? '✓' : '○'} tam={24}
                color={hecha ? tema.color.verde : tarde ? tema.color.avisoTexto : colorSistema.texto3} />
            </View>
            <View style={{ flex: 1, gap: 1 }}>
              <Text style={{ fontSize: 17, fontWeight: '600', color: hecha ? colorSistema.texto2 : colorSistema.texto }}>
                <Text style={{ fontVariant: ['tabular-nums'] }}>{horaTexto(x.hora)}</Text>{`  ${nombre}`}
              </Text>
              {detalle || cuando ? (
                <Text style={{ fontSize: 13, color: hecha ? tema.color.verdeTexto : tarde ? tema.color.avisoTexto : colorSistema.texto2 }}>
                  {[cuando, detalle].filter(Boolean).join(' · ')}
                </Text>
              ) : null}
            </View>
          </Presionable>
            {hecha
              ? <Capsula etiqueta="Deshacer" alTocar={() => deshacer(x, nombre)} prominente={false} />
              : <Capsula etiqueta="Tomar" alTocar={() => { Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success).catch(() => {}); marcarTomado(x.pid, x.hora); }} color={tema.color.verde} />}
          </View>
        );
      })}
    </Lista>
  );
}
const horaDe = (iso) => { const d = new Date(iso); return `${d.getHours()}:${String(d.getMinutes()).padStart(2, '0')}`; };

function Reintentar({ alTocar }) {
  const t = useTema();
  return (
    <Presionable onPress={alTocar} accessibilityRole="button" hitSlop={8} style={{ alignSelf: 'center', minHeight: 44, justifyContent: 'center', paddingHorizontal: 14 }}>
      <Text style={{ fontSize: 17, fontWeight: '700', color: t.color.magentaTexto }}>Reintentar</Text>
    </Presionable>
  );
}
