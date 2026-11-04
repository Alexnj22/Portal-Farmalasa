// Cuenta: permisos, avisos, reglamento, cerrar sesión y borrar la cuenta
// (Apple lo exige dentro de la app, 5.1.1(v)). Forma de Ajustes: grupos con
// interruptores del sistema y acciones en filas, la destructiva en rojo.
//
// 2026-10-12: la foto de perfil (opcional; la ve el equipo en el chat; si el
// equipo la quita, vuelve el avatar de siempre y se puede subir otra) y la
// entrada a «Pregúntale a la farmacia», con el punto de mensajes sin leer.
//
// 2026-10-14, ordenada en grupos como Ajustes: Perfil, Seguridad,
// Notificaciones, Ayuda y chat, Legal y privacidad, Modo de prueba (sólo la
// cuenta de prueba) y, al final, Cerrar sesión / Borrar mi cuenta. Salió de
// aquí lo que ya está en el Inicio (Invitar, Mis reservas, Mis tratamientos,
// Nuestras sucursales); se queda lo que sólo vive aquí (Mis facturas, Cliente
// Mayorista, ver o volver a agregar la tarjeta en Wallet — el Inicio sólo
// ofrece agregarla, y desde el 2026-11-04 sólo mientras no esté agregada:
// «quítalo de ahí si ya se agregó, y pásalo a cuenta». Aquí está SIEMPRE, en
// Apple Wallet y en Google Wallet).
//
// 2026-11-03 («en inicio dejar sólo 6 opciones… las otras a cuenta, y
// mejoramos cuenta»): Cuenta es ahora el ÍNDICE COMPLETO de la app — el Inicio
// tiene seis atajos y todo lo demás, más esos seis, está acá, para que nada
// dependa de recordar dónde estaba. Grupos, en el orden de uso:
//   Mis compras (reservas, compras, facturas, créditos, saldo a favor) ·
//   Mi salud (tratamientos, inyecciones) · Mis puntos (movimientos, invitar,
//   mayorista, Wallet) · Seguridad · Notificaciones · Ayuda (chat,
//   sucursales, guía, novedades) · Legal y privacidad · sesión.
// Cada fila: ícono en su recuadro de color + título + una línea de cómo va,
// con el número rojo cuando algo pide atención. Los contadores salen del mismo
// `resumen` que pinta el Inicio: no hay consultas nuevas.
import { useCallback, useEffect, useMemo, useState } from 'react';
import { useShallow } from 'zustand/react/shallow';
import * as Haptics from 'expo-haptics';
import { ActionSheetIOS, Alert, Platform, Text, View } from 'react-native';
import Presionable from '../../../componentes/Presionable';
import { useFocusEffect } from 'expo-router';
import { colorSistema, FilaInterruptor, Formulario, Grupo } from '../../../componentes/sistema';
import { Aviso, ESPACIO_BURBUJA } from '../../../componentes/ui';
import { MENSAJE_CODIGO, useConCodigo, useSesion } from '../../../lib/sesion';
import { irACompletarEntrada } from '../../../componentes/SoloConDocumento';
import { useCuenta } from '../../../lib/cuenta';
import { pedirTokenDeAvisos, recordarAvisos } from '../../../lib/avisos';
import { abrirPase, agregarAGoogleWallet, agregarDirecto, agregarPorSafari, googleWalletDisponible, marcarGoogleWalletAgregada, serieEnWallet, walletDisponible } from '../../../modules/wallet';
import { conBiometria, nombreBiometria, rotuloBiometria, sinBloquear, useBloqueo } from '../../../lib/bloqueo';
import { olvidarEntrada } from '../../../lib/entradaGuardada';
import { NIVELES_PRUEBA, useModoPrueba } from '../../../lib/prueba';
import { avanzarMuestra, reservasDeMuestra, resumenConDemo, useDemo } from '../../../lib/demo';
import Segmentos from '../../../componentes/Segmentos';
import { diasHasta, dolares, entero, fecha, nombrePropio } from '../../../lib/formato';
import { suave, useTema } from '../../../tema/tema';
import Icono from '../../../componentes/Icono';
import { navegar } from '../../../lib/navegar';
import AvatarNivel, { rotuloNivel } from '../../../componentes/AvatarNivel';
import { PARA_QUE_FOTO, refrescarFotoPerfil, subirFotoPerfil, useFotoPerfil } from '../../../lib/fotoPerfil';
import { QUE_ES_MAYORISTA, rangoReal } from '../../../componentes/Mayorista';
import { usarVistaPreviaFoto } from '../../../componentes/VistaPreviaFoto';
import { usePresentacion } from '../../../lib/novedades';


// La letra de las filas, la misma de `FilaTexto` (componentes/sistema.js):
// Body Large de Material 3 en Android, la de Ajustes en iPhone.
const LETRA_FILA = Platform.OS === 'android' ? 16 : 17;

/**
 * Una fila que se toca, como en Ajustes: ícono, texto en el color del sistema
 * y la flecha si lleva a otra pantalla. Sin el rosa de la marca en el texto
 * (usuario, 2026-10-06: «la letra rosa no me gusta»); el rojo sólo en lo
 * destructivo.
 *
 * 2026-11-03: con `tinte`, el ícono va en un recuadro de ese color (como
 * Ajustes), y `detalle` es una segunda línea corta de cómo va («2 listas»,
 * «Se te acaba en 3 días»). Nada se corta: sin `numberOfLines`, el texto
 * envuelve y la fila crece; mínimo 52 pt de alto, más que los 44 del dedo.
 */
function FilaAccion({ texto, detalle, sf, color, tinte, flecha = true, alTocar, insignia }) {
  const t = useTema();
  const etiqueta = [texto, detalle, insignia ? `${insignia} pendiente${insignia === 1 ? '' : 's'}` : null].filter(Boolean).join('. ');
  return (
    <Presionable accessibilityRole="button" accessibilityLabel={etiqueta}
      onPress={() => { Haptics.selectionAsync().catch(() => {}); alTocar(); }}
      style={({ pressed }) => ({ flexDirection: 'row', alignItems: 'center', gap: 12, minHeight: 52, paddingVertical: 10,
        paddingHorizontal: 16, backgroundColor: pressed ? colorSistema.separador : 'transparent' })}>
      {sf && tinte ? (
        // UN solo color para todos los íconos (usuario, 2026-11-03: «los
        // íconos tienen demasiados colores, unifica»): el de la marca en un
        // recuadro suave, y el rojo sólo en lo destructivo. El `tinte` de cada
        // fila ya no pinta: sólo pide el recuadro.
        <View style={{ width: 32, height: 32, borderRadius: 9, alignItems: 'center', justifyContent: 'center',
          backgroundColor: suave(color ? t.acentos.rojo.fuerte : t.color.magenta, t.oscuro ? 0.26 : 0.11) }}>
          <Icono sf={sf} respaldo="" tam={17} color={color ?? t.color.magentaTexto} />
        </View>
      ) : sf ? <Icono sf={sf} respaldo="" tam={18} color={color ?? colorSistema.texto2} /> : null}
      <View style={{ flex: 1, flexShrink: 1, gap: 2 }}>
        <Text style={{ fontSize: LETRA_FILA, color: color ?? colorSistema.texto }}>{texto}</Text>
        {detalle ? <Text style={{ fontSize: 13, lineHeight: 18, color: colorSistema.texto2 }}>{detalle}</Text> : null}
      </View>
      {insignia ? (
        <View style={{ minWidth: 22, height: 22, borderRadius: 11, paddingHorizontal: 6, alignItems: 'center', justifyContent: 'center', backgroundColor: colorSistema.rojo }}>
          <Text maxFontSizeMultiplier={1.2} style={{ fontSize: 12, fontWeight: '800', color: '#FFFFFF', fontVariant: ['tabular-nums'] }}>{insignia > 99 ? '99+' : insignia}</Text>
        </View>
      ) : null}
      {flecha && !color ? <Icono sf="chevron.right" respaldo="›" tam={13} color={colorSistema.texto3} /> : null}
    </Presionable>
  );
}

const plural = (n, uno, varios) => `${n} ${n === 1 ? uno : varios}`;

export default function Cuenta() {
  const t = useTema();
  const pedirW = useSesion((s) => s.pedir);
  const serialW = useCuenta((s) => s.resumen?.wallet_serial);
  // La serie que está en Wallet (la real o la del modo de prueba), o null.
  const [enWallet, setEnWallet] = useState(null);
  useFocusEffect(useCallback(() => { if (serialW) setEnWallet(serieEnWallet(serialW)); }, [serialW]));
  // Ya agregada: se abre en Wallet. Si no: se arma y se ofrece la hoja de Apple.
  // Sólo lo que esta pantalla lee del modo de prueba (2026-11-04, auditoría de
  // rendimiento): con el store entero, cada cambio del demo —un cupón, una
  // reserva de muestra— volvía a pintar toda Cuenta. El panel de prueba se
  // suscribe por su cuenta (sólo lo ve la cuenta de prueba).
  const prueba = useModoPrueba(useShallow((x) => ({ activo: x.activo, nivel: x.nivel, mayorista: x.mayorista, empleado: x.empleado })));
  // `abrir`: si ya está, se abre; si no (o al «volver a agregar»), se arma y
  // se ofrece la hoja de Apple. Volver a agregar sirve si se borró o se ocultó
  // en Wallet y la app todavía la ve (usuario, 2026-10-07).
  const wallet = async ({ abrir = true } = {}) => {
    if (abrir && enWallet && abrirPase(enWallet)) return;
    const enPrueba = !!resumen?.prueba && prueba.activo;
    // Directo a Wallet; por Safari si falla (2026-10-08).
    const ok = await sinBloquear(() => agregarDirecto(pedirW, enPrueba ? prueba.nivel : null));
    if (ok) setEnWallet(serieEnWallet(serialW));
    if (ok === null && !(await agregarPorSafari(pedirW, enPrueba ? prueba.nivel : null))) {
      Alert.alert('No se pudo preparar la tarjeta', 'Revisa tu conexión e intenta de nuevo.');
    }
  };
  // Google Wallet (Android): el mismo enlace sirve para agregarla y para verla
  // si ya está; Google decide. Se recuerda que se abrió, para que el Inicio
  // deje de ofrecerla (modules/wallet).
  const googleWallet = async () => {
    const enPrueba = !!resumen?.prueba && prueba.activo;
    if (!(await sinBloquear(() => agregarAGoogleWallet(pedirW, enPrueba ? prueba.nivel : null)))) {
      Alert.alert('No se pudo preparar la tarjeta', 'Revisa tu conexión e intenta de nuevo.');
      return;
    }
    await marcarGoogleWalletAgregada(resumen?.wallet_serial ?? resumen?.codigo);
  };
  // Con selectores (2026-11-04): `useCuenta()` a secas se suscribía al store
  // entero, y `cargando`/`cargadoAt` cambian en cada carga del Inicio.
  const { pedir, cerrar } = useSesion(useShallow((x) => ({ pedir: x.pedir, cerrar: x.cerrar })));
  const { resumen: crudo, cargar } = useCuenta(useShallow((x) => ({ resumen: x.resumen, cargar: x.cargar })));
  // El demo del modo de prueba (2026-10-20): el saldo a favor de muestra se ve
  // aquí como el real, y la vista «entró con el código» (lib/demo.js).
  const demo = useDemo();
  const resumen = useMemo(() => resumenConDemo(crudo, demo), [crudo, demo]);
  const [mensaje, setMensaje] = useState(null);
  const [biometria, setBiometria] = useState(null);
  const bloqueoActivo = useBloqueo((x) => x.activo);
  const encenderBloqueo = useBloqueo((x) => x.encender);
  const apagarBloqueo = useBloqueo((x) => x.apagar);
  useEffect(() => { nombreBiometria().then(setBiometria); }, []);

  useFocusEffect(useCallback(() => { if (!resumen) cargar(); }, [resumen, cargar]));

  // La foto de perfil (2026-10-12): firmada por el servidor. Desde el
  // 2026-10-14 («tarda en cargar») vive en lib/fotoPerfil.js: la última
  // conocida se pinta al instante desde la caché (por la ruta del archivo, no
  // por la URL firmada) y al entrar sólo se confirma con el servidor.
  const fotoGuardada = useFotoPerfil();
  const [subiendo, setSubiendo] = useState(false);
  const foto = { url: fotoGuardada.codigo === resumen?.codigo ? fotoGuardada.url : null, clave: fotoGuardada.clave,
    quitada: fotoGuardada.codigo === resumen?.codigo && fotoGuardada.quitada, cargando: subiendo };
  const conFicha = !!resumen && !resumen.pendiente;
  // Sesión de CÓDIGO (2026-10-19): sólo puntos, tarjeta y ofertas. Sin foto de
  // perfil, facturas, créditos, chat, permisos ni borrar la cuenta; en su
  // lugar, el camino a entrar con DUI y teléfono.
  const conCodigo = useConCodigo() || resumen?.alcance === 'codigo';
  const completa = conFicha && !conCodigo;
  useFocusEffect(useCallback(() => {
    if (!completa || !resumen?.codigo) return;
    refrescarFotoPerfil(resumen.codigo);
  }, [completa, resumen?.codigo]));
  const ponerFoto = (f) => useFotoPerfil.getState().poner(resumen?.codigo ?? null, f);
  // El nivel en el avatar (2026-10-14, «no me muestra en el avatar mi nivel»):
  // la misma cuenta que la tarjeta del Inicio — el rango de mayoreo si lo
  // tiene, si no su nivel; con el modo de prueba, el elegido ahí.
  const enPrueba = !!resumen?.prueba && prueba.activo;
  const materialAvatar = enPrueba ? (prueba.mayorista ?? prueba.nivel) : (rangoReal(resumen?.mayorista)?.clave ?? resumen?.nivel?.clave ?? null);
  const equipoAvatar = enPrueba ? !!prueba.empleado : !!resumen?.empleado;
  const nivelTexto = conFicha ? rotuloNivel(materialAvatar, equipoAvatar) : null;
  // Se revisa con la guía redonda antes de subirla (componentes/VistaPreviaFoto).
  const vistaPrevia = usarVistaPreviaFoto();
  const subirPerfil = async () => {
    const f = await vistaPrevia.elegir({ titulo: 'Tu foto de perfil', mensaje: PARA_QUE_FOTO, circular: true });
    if (!f) return;
    setSubiendo(true);
    const r = await subirFotoPerfil(resumen?.codigo ?? null, f.uri);
    setSubiendo(false);
    if (!r?.ok) Alert.alert('No se pudo guardar la foto', r?.mensaje ?? 'Revisa tu conexión e intenta de nuevo.');
  };
  const cambiarFoto = () => {
    Haptics.selectionAsync().catch(() => {});
    if (!foto.url) { subirPerfil(); return; }
    // La hoja de opciones del sistema (2026-10-13), como «Descargar» en
    // Facturas; en Android la dibuja componentes/HojasAndroid.
    const quitar = async () => {
      const r = await pedir('perfil_quitar');
      if (r?.ok) ponerFoto({ url: null, quitada: false });
      else Alert.alert('No se pudo quitar la foto', r?.mensaje ?? 'Revisa tu conexión.');
    };
    ActionSheetIOS.showActionSheetWithOptions({
      title: 'Tu foto de perfil',
      options: ['Cambiar foto', 'Quitar foto', 'Cancelar'],
      destructiveButtonIndex: 1,
      cancelButtonIndex: 2,
    }, (i) => {
      if (i === 0) subirPerfil();
      else if (i === 1) quitar();
    });
  };

  const c = resumen?.consentimiento;
  // Los números de las filas, del mismo `resumen` que pinta el Inicio.
  const listas = Number(resumen?.reservas_listas) || 0;
  const abiertas = Number(resumen?.reservas_abiertas) || 0;
  const vencidos = Number(resumen?.creditos?.vencidos) || 0;
  const inyecciones = Number(resumen?.inyecciones_pendientes) || 0;
  const chatSinLeer = Number(resumen?.chat_sin_leer) || 0;
  const listaTratamientos = Array.isArray(resumen?.tratamientos) ? resumen.tratamientos : [];
  const tratamientos = listaTratamientos.length;
  const urgentes = listaTratamientos.filter((x) => { const d = diasHasta(x.se_acaba); return d != null && d <= 3; }).length;

  // Optimista y con candado: el interruptor cambia al instante y no acepta
  // otro toque hasta que el servidor contesta. Antes volvía a su valor viejo
  // mientras se guardaba (parpadeo) y dos toques mandaban pedidos cruzados.
  const [guardando, setGuardando] = useState(null);
  const [local, setLocal] = useState({});
  const valorDe = (campo, delServidor) => (campo in local ? local[campo] : delServidor);

  async function guardarPermiso(campo, valor) {
    setMensaje(null);
    setGuardando(campo);
    setLocal((x) => ({ ...x, [campo]: valor }));
    const r = await pedir('permisos', { [campo]: valor });
    if (!r?.ok) setMensaje(r?.mensaje ?? 'No se pudo guardar.');
    await cargar({ forzar: true });
    setLocal((x) => { const { [campo]: _, ...resto } = x; return resto; });
    setGuardando(null);
  }

  function permiso(campo, valor) {
    if (guardando) return;
    // Quitar el programa congela el saldo: se pregunta antes.
    if (campo === 'programa' && !valor) {
      Alert.alert('¿Salir del programa de puntos?',
        'Tu saldo queda en pausa: no se pierde, pero no acumulas ni canjeas hasta que vuelvas a activarlo.', [
          { text: 'Cancelar', style: 'cancel' },
          { text: 'Salir del programa', style: 'destructive', onPress: () => guardarPermiso(campo, valor) },
        ]);
      return;
    }
    guardarPermiso(campo, valor);
  }

  async function avisos(valor) {
    if (guardando) return;
    setMensaje(null);
    let push_token = null;
    let formato = 1;
    let responde = false;
    if (valor) {
      // Nunca lanza hacia el botón (2026-10-12): un fallo del sistema es un mensaje.
      const r = await pedirTokenDeAvisos().catch(() => ({ error: 'No se pudieron activar los avisos. Intenta más tarde.' }));
      if (r.error) { setMensaje(r.error); return; }
      push_token = r.token;
      formato = r.formato;
      responde = !!r.responde;
    }
    setGuardando('avisos');
    setLocal((x) => ({ ...x, avisos: valor }));
    const r = await pedir('avisos', { acepta: valor, push_token, formato, responde });
    if (!r?.ok) setMensaje(r?.mensaje ?? 'No se pudo guardar.');
    else await recordarAvisos(valor);
    await cargar({ forzar: true });
    setLocal((x) => { const { avisos: _, ...resto } = x; return resto; });
    setGuardando(null);
  }

  function salir() {
    Alert.alert('¿Cerrar sesión?', 'Para volver a entrar vas a necesitar tu DUI y teléfono, o el código de tu ticket.', [
      { text: 'Cancelar', style: 'cancel' },
      { text: 'Cerrar sesión', style: 'destructive', onPress: async () => { await pedir('salir'); await cerrar(); } },
    ]);
  }

  // «Cerrar las demás sesiones» (2026-11-04): si se perdió un teléfono o se
  // entró en uno ajeno, cerrar ésas sin salir de ésta. Lo hace el servidor
  // (`cerrar_otras_sesiones`). Mientras esa acción no esté publicada, el
  // servidor contesta «Acción desconocida»: eso no se le muestra a nadie, se
  // dice que todavía no se puede.
  const [cerrandoOtras, setCerrandoOtras] = useState(false);
  const cerrarOtras = () => {
    if (cerrandoOtras) return;
    Alert.alert('¿Cerrar las demás sesiones?', 'Se cierra la sesión en los otros teléfonos donde entraste. En éste sigues dentro.', [
      { text: 'Cancelar', style: 'cancel' },
      { text: 'Cerrar las demás', style: 'destructive', onPress: async () => {
        setCerrandoOtras(true);
        try {
          const r = await pedir('cerrar_otras_sesiones');
          if (r?.ok) {
            Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success).catch(() => {});
            const n = [r.cerradas, r.sesiones, r.n].map(Number).find((x) => Number.isFinite(x));
            Alert.alert(n === 0 ? 'No había otras sesiones' : n ? `Cerramos ${plural(n, 'sesión', 'sesiones')}` : 'Listo',
              n === 0 ? 'Sólo estás dentro en este teléfono.' : 'Tus otros teléfonos tendrán que volver a entrar.');
          } else {
            const generico = 'Todavía no se puede hacer desde aquí. Intenta más tarde.';
            Alert.alert('No se cerraron', !r?.mensaje || /desconocida/i.test(r.mensaje) ? generico : r.mensaje);
          }
        } finally { setCerrandoOtras(false); }
      } },
    ]);
  };

  // Qué pasa con los puntos, dicho como es (2026-10-14). `borrar_cuenta` cierra
  // las sesiones, apaga los avisos, borra el pre-registro y —desde el
  // 2026-10-17— la foto de perfil, el contenido del chat y las fotos de receta
  // de lo que no se entregó (`borrarLoPersonal` en app-clientes); la FICHA no se
  // borra (es un registro fiscal) y con ella quedan los puntos. Con
  // `retirar_permisos` además guarda programa = no y promociones = no
  // (`puntos_guardar_consentimiento`): el Reglamento dice que entonces deja de
  // acumular y su saldo queda retenido —no vence ni se canjea— hasta que vuelva.
  function borrar() {
    if (conCodigo) {
      Alert.alert('Borrar tu cuenta', `${MENSAJE_CODIGO} Así sabemos que la cuenta es tuya.`, [
        { text: 'Cancelar', style: 'cancel' },
        { text: 'Entrar con DUI y teléfono', onPress: irACompletarEntrada },
      ]);
      return;
    }
    Alert.alert(
      '¿Borrar tu cuenta de la app?',
      // 2026-10-19: la lista completa, la misma de la cláusula 10 del aviso de
      // privacidad y de `borrarLoPersonal` (app-clientes). Se mueven juntas.
      'Se cierra la sesión en todos tus teléfonos, dejas de recibir avisos y se borran tu registro en la app, tu foto de perfil, tus conversaciones con la farmacia y el comentario con que las calificaste, los correos que guardaste para tus facturas, tu código para invitar, las novedades que viste y las fotos de recetas que no se usaron. Tu tarjeta de Apple Wallet deja de actualizarse y la de Google Wallet queda vencida. Las reservas abiertas que no pagaste se cancelan; las que pagaste siguen en pie.\n\n'
        + 'Se conservan, porque la ley lo exige: tu ficha de cliente con tus compras y facturas, y la receta de un medicamento que ya retiraste. Tus puntos siguen ahí: si compras con tu DUI sigues acumulando, y puedes volver a entrar cuando quieras.\n\n'
        + 'Si además quieres dejar de acumular puntos, elige «Retirar mi permiso del programa»: tu saldo queda en pausa (no vence ni se puede canjear) y dejas de recibir promociones, hasta que vuelvas a aceptarlo.',
      [
        { text: 'Cancelar', style: 'cancel' },
        { text: 'Borrar cuenta', style: 'destructive', onPress: () => confirmarBorrado(false) },
        { text: 'Borrar y retirar mi permiso del programa', style: 'destructive', onPress: () => confirmarBorrado(true) },
      ],
    );
  }

  async function confirmarBorrado(retirar) {
    const r = await pedir('borrar_cuenta', { retirar_permisos: retirar === true });
    if (r?.ok) { await olvidarEntrada(); await cerrar(); }
    else Alert.alert('No se pudo borrar la cuenta', r?.mensaje ?? 'Revisa tu conexión e intenta de nuevo.');
  }

  return (
    // Abajo, el lugar de la burbuja del chat (2026-10-13).
    <Formulario contentContainerStyle={Platform.OS === 'web' ? undefined : { paddingBottom: 20 + ESPACIO_BURBUJA }}>
      {vistaPrevia.vista}
      {resumen?.nombre ? (
        // El encabezado de Cuenta (2026-10-20, «el aro no se distingue qué
        // nivel es»): la foto grande al centro, con el aro y la placa de su
        // nivel debajo, y el nombre abajo.
        <View style={{ alignItems: 'center', gap: 10, marginHorizontal: 24, marginTop: 4 }}>
          {completa ? (
            <Presionable onPress={cambiarFoto} accessibilityRole="button" accessibilityLabel={foto.url ? 'Cambiar tu foto de perfil' : 'Agregar una foto de perfil'}
              style={({ pressed }) => ({ transform: [{ scale: pressed ? 0.95 : 1 }] })}>
              <AvatarNivel nombre={resumen.nombre} material={materialAvatar} equipo={equipoAvatar} uri={foto.url} clave={foto.clave} tam={96} atenuado={foto.cargando} insignia />
              <View style={{ position: 'absolute', right: 0, top: 2, width: 28, height: 28, borderRadius: 14, alignItems: 'center', justifyContent: 'center',
                backgroundColor: t.color.magenta, borderWidth: 2, borderColor: t.oscuro ? '#1C1B22' : '#FFFFFF' }}>
                <Icono sf="camera.fill" respaldo="+" tam={12} color="#FFFFFF" />
              </View>
            </Presionable>
          ) : (
            <AvatarNivel nombre={resumen.nombre} material={materialAvatar} equipo={equipoAvatar} tam={96} insignia />
          )}
          <View style={{ alignItems: 'center', gap: 2 }}>
            <Text style={{ fontSize: 22, fontWeight: '800', color: colorSistema.texto, textAlign: 'center' }}>
              {nombrePropio(resumen.nombre)}
            </Text>
            {nivelTexto ? (
              <Text style={{ fontSize: 14, fontWeight: '600', color: colorSistema.texto2, textAlign: 'center' }}>{nivelTexto}</Text>
            ) : null}
            {completa && foto.quitada ? (
              <Text style={{ fontSize: 13, color: colorSistema.texto2, textAlign: 'center' }}>Quitamos tu foto de perfil porque no correspondía. Puedes subir otra.</Text>
            ) : completa && !foto.url ? (
              <Text style={{ fontSize: 13, color: colorSistema.texto3, textAlign: 'center' }}>Toca la foto para agregarla (opcional)</Text>
            ) : null}
          </View>
        </View>
      ) : null}
      {mensaje ? <Aviso>{mensaje}</Aviso> : null}

      {/* Mis compras: lo que más se abre, primero. Con la sesión de código
          sólo el camino a entrar con DUI y teléfono (el servidor no las da). */}
      {conFicha ? (
        <Grupo titulo="Mis compras">
          {conCodigo ? (
            <FilaAccion sf="person.text.rectangle.fill" tinte={t.color.magenta} texto="Ver mis compras, facturas y reservas"
              detalle="Entra con tu DUI y teléfono" alTocar={irACompletarEntrada} />
          ) : null}
          {!conCodigo ? (
            <FilaAccion sf="bag.fill" tinte={t.color.magenta} texto="Mis reservas" insignia={listas}
              detalle={listas ? `${plural(listas, 'lista', 'listas')} para retirar` : abiertas ? `${plural(abiertas, 'en curso', 'en curso')}` : 'Aparta y retira en tu sucursal'}
              alTocar={() => navegar('/reservas')} />
          ) : null}
          {!conCodigo ? (
            <FilaAccion sf="list.bullet.rectangle.fill" tinte={t.acentos.violeta.fuerte} texto="Mis compras"
              detalle="Lo que compraste, para volver a pedirlo" alTocar={() => navegar('/compras')} />
          ) : null}
          {/* Sólo créditos fiscales (2026-10-20): sin ninguno, no hay qué ver.
              Un servidor viejo no manda `con_ccf`: ahí se ofrece igual. */}
          {!conCodigo && resumen?.con_ccf !== false ? (
            <FilaAccion sf="doc.richtext.fill" tinte={t.acentos.azul.fuerte} texto="Mis facturas"
              detalle="Descárgalas o envíalas por correo" alTocar={() => navegar('/facturas')} />
          ) : null}
          {/* Mis créditos (2026-10-15): sólo si debe algo; la insignia, los vencidos. */}
          {!conCodigo && resumen?.creditos?.pendientes > 0 ? (
            <FilaAccion sf="creditcard.fill" tinte={t.acentos.rojo.fuerte} texto="Mis créditos" insignia={vencidos}
              detalle={vencidos ? `${plural(vencidos, 'vencido', 'vencidos')}` : `${plural(Number(resumen.creditos.pendientes), 'pendiente, al día', 'pendientes, al día')}`}
              alTocar={() => navegar('/creditos')} />
          ) : null}
          {/* Saldo a favor (2026-10-19): lo pagado que no se entregó o un
              anticipo; vale en cualquier sucursal. El detalle, en Mis reservas. */}
          {!conCodigo && resumen?.saldo_a_favor?.total > 0 ? (
            <FilaAccion sf="dollarsign.circle.fill" tinte={t.acentos.verde.fuerte} texto={`Saldo a favor: ${dolares(resumen.saldo_a_favor.total)}`}
              detalle={`${resumen.saldo_a_favor.vence ? `Hasta el ${fecha(resumen.saldo_a_favor.vence)} · ` : ''}úsalo en cualquier sucursal`}
              alTocar={() => navegar('/reservas')} />
          ) : null}
        </Grupo>
      ) : null}

      {/* Mi salud: tratamientos e inyecciones. */}
      {completa ? (
        <Grupo titulo="Mi salud">
          <FilaAccion sf="pills.fill" tinte={t.acentos.azul.fuerte} texto="Mis tratamientos" insignia={urgentes}
            detalle={urgentes ? `${plural(urgentes, 'se acaba', 'se acaban')} en 3 días o menos` : tratamientos ? plural(tratamientos, 'activo', 'activos') : 'Te avisamos antes de que se acabe'}
            alTocar={() => navegar('/tratamientos')} />
          <FilaAccion sf="syringe.fill" tinte={t.acentos.verde.fuerte} texto="Mis inyecciones" insignia={inyecciones}
            detalle={inyecciones ? `${plural(inyecciones, 'por aplicar', 'por aplicar')}` : 'Al día'}
            alTocar={() => navegar('/inyecciones')} />
        </Grupo>
      ) : null}

      {/* Mis puntos: el programa, invitar, mayoreo y la tarjeta en Wallet. */}
      {conFicha ? (
        <Grupo titulo="Mis puntos">
          <FilaAccion sf="star.fill" tinte={t.acentos.naranja.fuerte} texto="Movimientos de puntos"
            detalle={`${entero(Number(resumen?.saldo ?? 0))} puntos · lo que ganaste y usaste`} alTocar={() => navegar('/movimientos')} />
          <FilaAccion sf="person.2.fill" tinte={t.acentos.verde.fuerte} texto="Invitar a un amigo"
            detalle="Ganan 50 puntos cada uno" alTocar={() => navegar('/invitar')} />
          {!conCodigo ? <FilaMayorista m={resumen.mayorista} pedir={pedir} alCambiar={() => cargar({ forzar: true })} /> : null}
          {/* La tarjeta en Wallet, SIEMPRE aquí (2026-11-04): agregarla si no
              está; verla o volver a agregarla si ya está. */}
          {Platform.OS === 'ios' && resumen?.wallet_serial && walletDisponible() ? (
            enWallet ? (
              <>
                <FilaAccion sf="wallet.pass.fill" tinte texto="Ver mi tarjeta en Apple Wallet"
                  detalle="Para mostrarla en caja sin abrir la app" alTocar={() => wallet()} />
                <FilaAccion sf="arrow.clockwise" tinte texto="Volver a agregar la tarjeta a Wallet"
                  detalle="Si la borraste u ocultaste en Wallet" alTocar={() => wallet({ abrir: false })} />
              </>
            ) : (
              <FilaAccion sf="wallet.pass.fill" tinte texto="Agregar mi tarjeta a Apple Wallet"
                detalle="Para mostrarla en caja sin abrir la app" alTocar={() => wallet({ abrir: false })} />
            )
          ) : null}
          {googleWalletDisponible(resumen) ? (
            <FilaAccion sf="wallet.pass.fill" tinte texto="Mi tarjeta en Google Wallet"
              detalle="Verla o agregarla, para mostrarla en caja sin abrir la app" alTocar={googleWallet} />
          ) : null}
        </Grupo>
      ) : null}

      {/* Seguridad: sólo si el teléfono tiene una biometría registrada, y con
          su nombre real (Face ID, Touch ID, huella…; «biometría» si hay varias). */}
      {biometria ? (
        <Grupo titulo="Seguridad" pie={Platform.OS === 'android'
          ? `Pide ${rotuloBiometria(biometria)} al abrir la app y cada vez que vuelves a ella, para que nadie más vea tu saldo ni tu código.`
          : `Pide ${rotuloBiometria(biometria)} al abrir la app y al volver después de un rato, para que nadie más vea tu saldo ni tu código.`}>
          <FilaInterruptor titulo={`Bloquear ${conBiometria(biometria)}`} valor={bloqueoActivo}
            alCambiar={async (v) => {
              if (!v) { await apagarBloqueo(); return; }
              if (!(await encenderBloqueo())) Alert.alert('No se activó el bloqueo', `Para activarlo hay que confirmar ${conBiometria(biometria)}.`);
            }} color={t.color.magenta} />
        </Grupo>
      ) : null}

      {!conCodigo || resumen?.acepta_avisos === true ? (
      <Grupo titulo="Notificaciones" pie="Ofertas nuevas, puntos por vencer y tus reservas. Las promociones son las ofertas personalizadas que te mandamos.">
        {/* Con el código, los avisos sólo se pueden apagar: hablan de reservas, chat y facturas. */}
        {!conCodigo || resumen?.acepta_avisos === true ? (
          <FilaInterruptor titulo="Avisos en este teléfono" valor={valorDe('avisos', resumen?.acepta_avisos === true)}
            alCambiar={avisos} color={t.color.magenta} />
        ) : null}
        {completa ? (
          <FilaInterruptor titulo="Promociones" detalle={c?.textos?.promociones}
            valor={valorDe('promociones', c?.promociones === true)} alCambiar={(v) => permiso('promociones', v)} color={t.color.magenta} />
        ) : null}
        {/* La bandeja (la campana del Inicio), también desde aquí. */}
        {conFicha ? (
          <FilaAccion sf="bell.fill" tinte={t.color.magenta} texto="Mis avisos" detalle="Los que te llegaron a la campana"
            alTocar={() => navegar('/notificaciones')} />
        ) : null}
      </Grupo>
      ) : null}

      {/* Ayuda (2026-10-12; desde el 2026-11-03 con las sucursales también
          aquí, que salieron del Inicio sólo con ficha pendiente). El chat,
          con los sin leer; con la sesión de código no hay chat. */}
      <Grupo titulo="Ayuda" pie={conFicha && !conCodigo ? 'Te responde el equipo de Farmacia Salud en el horario de las sucursales.' : undefined}>
        {conFicha && !conCodigo ? (
          <FilaAccion sf="bubble.left.and.bubble.right.fill" tinte={t.color.magenta} texto="Pregúntale a la farmacia" insignia={chatSinLeer}
            detalle={chatSinLeer ? `${plural(chatSinLeer, 'respuesta', 'respuestas')} sin leer` : 'Escríbenos por el chat'}
            alTocar={() => navegar('/chat')} />
        ) : null}
        <FilaAccion sf="mappin.and.ellipse" tinte={t.acentos.violeta.fuerte} texto="Nuestras sucursales" detalle="Horarios y cómo llegar"
          alTocar={() => navegar('/sucursales')} />
        {/* La guía del primer inicio y las novedades de esta versión, otra vez (2026-10-14). */}
        <FilaAccion sf="questionmark.circle" tinte={t.acentos.azul.fuerte} texto="Cómo funciona la app" alTocar={() => navegar('/guia')} />
        <FilaAccion sf="sparkles" tinte={t.acentos.naranja.fuerte} texto="Novedades" detalle="Lo nuevo de esta versión"
          alTocar={() => usePresentacion.getState().abrirNovedades()} />
      </Grupo>

      <Grupo titulo="Legal y privacidad" pie={completa ? 'Si quitas el programa, tu saldo queda en pausa; no se pierde.' : undefined}>
        {completa ? (
          <FilaInterruptor titulo="Programa de puntos" detalle={c?.textos?.programa}
            valor={valorDe('programa', c?.programa !== false)} alCambiar={(v) => permiso('programa', v)} color={t.color.magenta} />
        ) : null}
        <FilaAccion sf="doc.text.fill" tinte={t.acentos.violeta.fuerte} texto="Reglamento del programa" alTocar={() => navegar('/legal?doc=reglamento')} />
        <FilaAccion sf="hand.raised.fill" tinte={t.acentos.violeta.fuerte} texto="Aviso de privacidad" detalle="Qué datos guardamos y para qué" alTocar={() => navegar('/legal?doc=privacidad')} />
      </Grupo>

      {resumen?.prueba ? <PanelDePrueba pedir={pedir} /> : null}

      <Grupo>
        {/* Con la sesión de código no: desde un ticket no se cierra la sesión
            de quien entró con su DUI. */}
        {conFicha && !conCodigo ? (
          <FilaAccion sf="iphone.slash" tinte={t.acentos.azul.fuerte} texto="Cerrar las demás sesiones" detalle="En los otros teléfonos donde entraste"
            flecha={false} alTocar={cerrarOtras} />
        ) : null}
        <FilaAccion sf="rectangle.portrait.and.arrow.right" tinte={t.acentos.azul.fuerte} texto="Cerrar sesión" flecha={false} alTocar={salir} />
        <FilaAccion sf="trash" tinte={t.acentos.rojo.fuerte} texto="Borrar mi cuenta" color={colorSistema.rojo} alTocar={borrar} />
      </Grupo>
    </Formulario>
  );
}

// '2026-11-03' → '3/11' (la fecha sola, sin zona: es un día del calendario).
const fechaCorta = (iso) => { const [, mm, dd] = String(iso).slice(0, 10).split('-'); return dd && mm ? `${Number(dd)}/${Number(mm)}` : String(iso); };

// Cliente Mayorista (Condiciones §2, Procedimiento §3): se pide desde aquí y
// lo decide Administración en el portal en 5 días hábiles.
function FilaMayorista({ m, pedir, alCambiar }) {
  const t = useTema();
  const tinte = t.acentos.violeta.fuerte;
  const estado = m?.estado;
  if (estado === 'aprobado') {
    // Un cambio avisado (2026-10-19, Condiciones §6): rige 15 días después.
    const cambio = m.retiro_programado ? ` · termina el ${fechaCorta(m.retiro_programado)}`
      : m.precio_programado_el ? ` · pasa a Mayoreo el ${fechaCorta(m.precio_programado_el)}` : '';
    return <FilaAccion tinte={tinte} sf="diamond.fill" texto={`Cliente Mayorista · ${m.precio === 'mayoreo_plus' ? 'Mayoreo Plus' : 'Mayoreo'}${cambio}`} flecha={false} alTocar={() => navegar('/puntos')} />;
  }
  if (estado === 'solicitado') {
    return <FilaAccion tinte={tinte} sf="clock.fill" texto="Cliente Mayorista: solicitud en revisión" flecha={false}
      alTocar={() => Alert.alert('Solicitud en revisión', 'Administración la responde en un máximo de 5 días hábiles. Te avisamos aquí.')} />;
  }
  const pedirla = () => Alert.alert(QUE_ES_MAYORISTA.titulo, QUE_ES_MAYORISTA.texto,
    [{ text: 'Cancelar', style: 'cancel' }, { text: 'Solicitar', onPress: async () => {
      const r = await pedir('solicitar_mayorista', {});
      Alert.alert(r?.ok ? 'Solicitud enviada' : 'No se pudo', r?.ok ? 'Te avisamos cuando Administración la revise.' : (r?.mensaje ?? 'Revisa tu conexión.'));
      if (r?.ok) alCambiar?.();
    } }]);
  // Rechazada (2026-10-19): se muestra el motivo que escribió Administración
  // (Condiciones §2.4) y se puede volver a pedir sin espera.
  if (estado === 'rechazado') {
    return (
      <>
        <FilaAccion tinte={tinte} sf="xmark.circle" texto={`Solicitud no aprobada${m?.motivo ? `: ${m.motivo}` : ''}`} flecha={false}
          alTocar={() => Alert.alert('Solicitud no aprobada', m?.motivo ? `Motivo: ${m.motivo}\n\nPuedes volver a pedirlo cuando quieras.` : 'Puedes volver a pedirlo cuando quieras.')} />
        <FilaAccion tinte={tinte} sf="diamond" texto="Volver a solicitar ser Cliente Mayorista" alTocar={pedirla} />
      </>
    );
  }
  return <FilaAccion tinte={tinte} sf="diamond" texto="Quiero ser Cliente Mayorista" alTocar={pedirla} />;
}

// El panel del modo de prueba (2026-10-07; ordenado en subgrupos y ampliado
// para usar la app como DEMO el 2026-10-20). Sólo lo ve la cuenta de prueba
// (`resumen.prueba`, la fila `modo_prueba` en el servidor): la del revisor de
// las tiendas tiene muestras pero no esto. Todo lo nuevo vive en la memoria
// del teléfono (lib/demo.js) y no escribe nada en el servidor; sólo «Avisos al
// teléfono» —que ya existía— le pide al servidor que mande el aviso.
function PanelDePrueba({ pedir }) {
  const t = useTema();
  // El store entero, a propósito: este panel muestra y cambia casi todo.
  const prueba = useModoPrueba();
  const demo = useDemo();
  const cupon = prueba.activo && ['oro', 'platino'].includes(prueba.nivel);
  const nombreNivel = prueba.activo ? (NIVELES_PRUEBA.find((n) => n.clave === prueba.nivel)?.nombre ?? '') : '';
  const hora = () => Date.now().toString(36);
  const avanzar = () => {
    const cambios = avanzarMuestra(demo);
    if (!Object.keys(cambios).length) {
      Alert.alert('Nada que avanzar', 'Las reservas de muestra ya no tienen nada en revisión ni en preparación. «Volver a empezar» las deja como al principio.');
      return;
    }
    prueba.cambiarReservas(cambios);
    Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success).catch(() => {});
    navegar('/reservas');
  };
  const reiniciarTodo = () => Alert.alert('¿Reiniciar el modo de prueba?',
    'Vuelve a tu nivel real, quita el saldo y las reservas de muestra, la vista con el código y lo simulado en los puntos y el cupón.', [
      { text: 'Cancelar', style: 'cancel' },
      { text: 'Reiniciar', style: 'destructive', onPress: () => {
        prueba.reiniciarTodo();
        Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success).catch(() => {});
      } },
    ]);
  const muestras = demo ? reservasDeMuestra(demo).length : 0;
  return (
    <>
      <Grupo titulo="Modo de prueba · Tarjeta y nivel" pie="Sólo en esta cuenta de prueba. Cambia cómo se ve la app (tarjeta, nivel, cupón y la tarjeta de Wallet que se agrega); no cambia puntos ni datos.">
        <FilaInterruptor titulo="Ver la app como otro nivel" valor={prueba.activo}
          alCambiar={(v) => prueba.poner({ activo: v })} color={t.color.magenta} />
        {prueba.activo ? (
          <View style={{ padding: 12 }}>
            <Segmentos valor={prueba.nivel} alCambiar={(n) => prueba.poner({ nivel: n })}
              opciones={NIVELES_PRUEBA.map((n) => ({ valor: n.clave, rotulo: n.nombre }))} />
          </View>
        ) : null}
        {prueba.activo ? (
          <FilaInterruptor titulo="Ver como empleado" detalle="Su nivel o rango con el sello Team."
            valor={!!prueba.empleado} alCambiar={(v) => prueba.poner({ empleado: v })} />
        ) : null}
        {prueba.activo ? (
          <View style={{ padding: 12, gap: 6 }}>
            <Text style={{ fontSize: 13, color: colorSistema.texto2 }}>Logo de la tarjeta</Text>
            <Segmentos valor={prueba.logo ?? 'color'} alCambiar={(v) => prueba.poner({ logo: v })}
              opciones={[{ valor: 'color', rotulo: 'Con color' }, { valor: 'material', rotulo: 'Del material' }]} />
          </View>
        ) : null}
        {prueba.activo ? (
          <View style={{ padding: 12, gap: 6 }}>
            {/* 2026-10-12: el catálogo, el producto y el carrito con el precio de mayoreo. «Según rango» sigue al rango de muestra. */}
            <Text style={{ fontSize: 13, color: colorSistema.texto2 }}>Ver precios de mayoreo (sólo se ven; al reservar se cobra el precio real)</Text>
            <Segmentos valor={prueba.precio ?? 'rango'} alCambiar={(v) => prueba.poner({ precio: v === 'rango' ? null : v })}
              opciones={[{ valor: 'rango', rotulo: 'Según rango' }, { valor: 'no', rotulo: 'No' }, { valor: 'mayoreo', rotulo: 'Mayoreo' }, { valor: 'mayoreo_plus', rotulo: 'Plus' }]} />
          </View>
        ) : null}
        {prueba.activo ? (
          <View style={{ padding: 12, gap: 6 }}>
            <Text style={{ fontSize: 13, color: colorSistema.texto2 }}>Cliente Mayorista</Text>
            <Segmentos valor={prueba.mayorista ?? 'no'} alCambiar={(m) => prueba.poner({ mayorista: m === 'no' ? null : m })}
              opciones={[{ valor: 'no', rotulo: 'No' }, { valor: 'jade', rotulo: 'Jade' }, { valor: 'zafiro', rotulo: 'Zafiro' }, { valor: 'rubi', rotulo: 'Rubí' }, { valor: 'diamante', rotulo: 'Diam.' }]} />
          </View>
        ) : null}
        {cupon ? <FilaAccion sf="arrow.counterclockwise" texto="Volver a tapar el cupón" alTocar={() => { prueba.reiniciarCupon(); navegar('/puntos'); }} /> : null}
        {cupon ? <FilaAccion sf="sparkles" texto="Ver la animación del cupón" alTocar={() => { prueba.verAnimacionCupon(); navegar('/puntos'); }} /> : null}
        {cupon ? (
          <FilaAccion sf="checkmark.seal.fill" texto={prueba.cuponUsado ? 'Ver el cupón sin usar' : 'Ver el cupón ya usado'}
            alTocar={() => { prueba.verCuponUsado(!prueba.cuponUsado); navegar('/puntos'); }} />
        ) : null}
        <FilaAccion sf="plus.circle.fill" texto="Simular: ganar 250 puntos" alTocar={() => { prueba.simularPuntos(250); navegar('/puntos'); }} />
        <FilaAccion sf="minus.circle.fill" texto="Simular: usar 500 puntos" alTocar={() => { prueba.simularPuntos(-500); navegar('/puntos'); }} />
      </Grupo>

      <Grupo titulo="Modo de prueba · Reservas y saldo" pie="De muestra y sólo en este teléfono: no llegan a ninguna sucursal. Pagar, cancelar, mandar la foto o quitar lo bajo receta cambia la muestra, sin cobrar ni enviar nada.">
        <FilaInterruptor titulo="Reservas de muestra"
          detalle="Una en cada paso: receta por subir, receta en revisión, pedido con otra foto pedida, en preparación, lista sin pagar, pagada en línea, cobro de prueba, vencida con saldo a favor, receta rechazada y retirada."
          valor={prueba.reservasMuestra} alCambiar={(v) => prueba.ponerDemo({ reservasMuestra: v })} color={t.color.magenta} />
        <View style={{ padding: 12, gap: 6 }}>
          <Text style={{ fontSize: 13, color: colorSistema.texto2 }}>Saldo a favor de muestra ($14.75 de una reserva pagada en línea que venció)</Text>
          <Segmentos valor={prueba.saldoFavor} alCambiar={(v) => prueba.ponerDemo({ saldoFavor: v })}
            opciones={[{ valor: 'no', rotulo: 'No' }, { valor: 'vigente', rotulo: 'Vigente' }, { valor: 'usado', rotulo: 'Ya usado' }]} />
        </View>
        {muestras ? <FilaAccion sf="bag.fill" texto="Abrir Mis reservas" alTocar={() => navegar('/reservas')} /> : null}
        {prueba.reservasMuestra ? (
          <FilaAccion sf="forward.fill" texto="Simular: la sucursal avanza un paso" alTocar={avanzar} />
        ) : null}
        {muestras ? (
          <FilaAccion sf="arrow.counterclockwise" texto="Volver a empezar las reservas de muestra" flecha={false}
            alTocar={() => { prueba.reiniciarReservas(); Haptics.selectionAsync().catch(() => {}); }} />
        ) : null}
      </Grupo>

      <Grupo titulo="Modo de prueba · Momentos" pie="Se abren en el Inicio cuando quieras, aunque ya se hayan visto.">
        <FilaAccion sf="crown.fill" texto={nombreNivel ? `Ver «¡Subiste a ${nombreNivel}!»` : 'Ver la pantalla de subir de nivel'}
          alTocar={() => navegar(`/puntos?nivel=${hora()}`)} />
        <FilaAccion sf="person.crop.circle.badge.checkmark" texto="Ver la bienvenida «Tu nivel»" alTocar={() => navegar(`/puntos?tunivel=${hora()}`)} />
        <FilaAccion sf="gift.fill" texto="Ver el saludo de cumpleaños" alTocar={() => navegar(`/puntos?cumple=${Date.now()}`)} />
        {/* Mayoreo (2026-10-09): con el rango de prueba elegido arriba. */}
        {prueba.activo && prueba.mayorista ? (
          <FilaAccion sf="diamond.fill" texto="Ver la pantalla de subir de rango" alTocar={() => navegar(`/puntos?rango=${hora()}`)} />
        ) : null}
        {prueba.activo && prueba.mayorista ? (
          <FilaAccion sf="tag.fill" texto="Ver la pantalla de precio Mayoreo Plus" alTocar={() => navegar(`/puntos?precio=${hora()}`)} />
        ) : null}
        {prueba.activo && prueba.mayorista ? (
          <FilaAccion sf="sparkles" texto="Ver la bienvenida a precio de mayoreo" alTocar={() => navegar(`/puntos?mayoreo=${hora()}`)} />
        ) : null}
        {/* 2026-10-14: la guía y las novedades a pedido, sin mirar si ya se vieron. */}
        <FilaAccion sf="questionmark.circle" texto="Ver primer inicio" alTocar={() => navegar('/guia')} />
        <FilaAccion sf="sparkles" texto="Ver novedades" alTocar={() => usePresentacion.getState().abrirNovedades()} />
      </Grupo>

      <Grupo titulo="Modo de prueba · Avisos al teléfono" pie="Llegan de verdad a este teléfono (con los avisos activados) y a la campana. Toca el aviso para ver la pantalla que abre.">
        {[['cumpleanos', 'gift.fill', 'Cumpleaños'], ['puntos', 'star.fill', 'Ganaste puntos'], ['cupon', 'ticket.fill', 'Cupón del mes'],
          ['nivel', 'crown.fill', 'Subiste de nivel'], ['rango', 'diamond.fill', 'Subiste de rango (mayoreo)'], ['precio', 'tag.fill', 'Precio Mayoreo Plus'],
          ['mayoreo', 'sparkles', 'Aprobado en mayoreo'], ['tratamiento', 'pills.fill', 'Tratamiento'], ['restado', 'minus.circle.fill', 'Usaste puntos'], ['reserva', 'bag.fill', 'Reserva lista'],
          ['credito', 'creditcard.fill', 'Crédito vencido']].map(([tipo, sf, texto]) => (
          <FilaAccion key={tipo} sf={sf} texto={`Recibir aviso: ${texto}`} flecha={false} alTocar={async () => {
            const r = await pedir('prueba_aviso', { tipo });
            Alert.alert(r?.ok ? 'Aviso enviado' : 'No se envió', r?.ok ? 'Llega en unos segundos. Bloquea el teléfono para verlo como notificación.' : (r?.mensaje ?? 'Revisa tu conexión.'));
          }} />
        ))}
      </Grupo>

      <Grupo titulo="Modo de prueba · Vista" pie="«Reiniciar» deja la app como sin el modo de prueba: tu nivel real, sin muestras y con la vista completa.">
        <FilaInterruptor titulo="Ver como si entró con el código del ticket"
          detalle="Sólo puntos, tarjeta, nivel y ofertas; compras, facturas, reservas y el chat piden DUI y teléfono. Tu sesión sigue igual."
          valor={prueba.vistaCodigo} alCambiar={(v) => prueba.ponerDemo({ vistaCodigo: v })} color={t.color.magenta} />
        {prueba.vistaCodigo ? (
          <FilaAccion sf="person.text.rectangle" texto="Ver la pantalla que pide DUI y teléfono" alTocar={() => navegar('/completar')} />
        ) : null}
        <FilaAccion sf="arrow.uturn.backward.circle" texto="Reiniciar todo el modo de prueba" color={colorSistema.rojo} flecha={false} alTocar={reiniciarTodo} />
      </Grupo>
    </>
  );
}
