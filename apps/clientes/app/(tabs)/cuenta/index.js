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
// Nuestras sucursales y «Agregar a Google Wallet», que allá está siempre); se
// queda lo que sólo vive aquí (Mis facturas, Cliente Mayorista, ver o volver a
// agregar la tarjeta en Apple Wallet — el Inicio sólo ofrece agregarla).
import { useCallback, useEffect, useMemo, useState } from 'react';
import * as Haptics from 'expo-haptics';
import { ActionSheetIOS, Alert, Platform, Text, View } from 'react-native';
import Presionable from '../../../componentes/Presionable';
import { useFocusEffect } from 'expo-router';
import { colorSistema, FilaInterruptor, FilaTexto, Formulario, Grupo } from '../../../componentes/sistema';
import { Aviso, ESPACIO_BURBUJA } from '../../../componentes/ui';
import { MENSAJE_CODIGO, useConCodigo, useSesion } from '../../../lib/sesion';
import { irACompletarEntrada } from '../../../componentes/SoloConDocumento';
import { useCuenta } from '../../../lib/cuenta';
import { pedirTokenDeAvisos, recordarAvisos } from '../../../lib/avisos';
import { abrirPase, agregarDirecto, agregarPorSafari, tienePase, walletDisponible } from '../../../modules/wallet';
import { conBiometria, nombreBiometria, rotuloBiometria, sinBloquear, useBloqueo } from '../../../lib/bloqueo';
import { olvidarEntrada } from '../../../lib/entradaGuardada';
import { NIVELES_PRUEBA, useModoPrueba } from '../../../lib/prueba';
import { avanzarMuestra, reservasDeMuestra, resumenConDemo, useDemo } from '../../../lib/demo';
import Segmentos from '../../../componentes/Segmentos';
import { dolares, fecha, nombrePropio } from '../../../lib/formato';
import { useTema } from '../../../tema/tema';
import Icono from '../../../componentes/Icono';
import { navegar } from '../../../lib/navegar';
import AvatarNivel, { rotuloNivel } from '../../../componentes/AvatarNivel';
import { PARA_QUE_FOTO, refrescarFotoPerfil, subirFotoPerfil, useFotoPerfil } from '../../../lib/fotoPerfil';
import { rangoReal } from '../../../componentes/Mayorista';
import { usarVistaPreviaFoto } from '../../../componentes/VistaPreviaFoto';
import { usePresentacion } from '../../../lib/novedades';


/**
 * Una fila que se toca, como en Ajustes: ícono, texto en el color del sistema
 * y la flecha si lleva a otra pantalla. Sin el rosa de la marca en el texto
 * (usuario, 2026-10-06: «la letra rosa no me gusta»); el rojo sólo en lo
 * destructivo.
 */
function FilaAccion({ texto, sf, color, flecha = true, alTocar, insignia }) {
  return (
    <Presionable accessibilityRole="button" onPress={() => { Haptics.selectionAsync().catch(() => {}); alTocar(); }}
      style={({ pressed }) => ({ flexDirection: 'row', alignItems: 'center', paddingLeft: sf ? 16 : 0, paddingRight: 16,
        backgroundColor: pressed ? colorSistema.separador : 'transparent' })}>
      {sf ? <Icono sf={sf} respaldo="" tam={18} color={color ?? colorSistema.texto2} /> : null}
      <View style={{ flex: 1 }}><FilaTexto color={color}>{texto}</FilaTexto></View>
      {insignia ? (
        <View style={{ minWidth: 22, height: 22, borderRadius: 11, paddingHorizontal: 6, marginRight: 8, alignItems: 'center', justifyContent: 'center', backgroundColor: colorSistema.rojo }}>
          <Text maxFontSizeMultiplier={1.2} style={{ fontSize: 12, fontWeight: '800', color: '#FFFFFF', fontVariant: ['tabular-nums'] }}>{insignia > 99 ? '99+' : insignia}</Text>
        </View>
      ) : null}
      {flecha && !color ? <Icono sf="chevron.right" respaldo="›" tam={13} color={colorSistema.texto3} /> : null}
    </Presionable>
  );
}

export default function Cuenta() {
  const t = useTema();
  const pedirW = useSesion((s) => s.pedir);
  const serialW = useCuenta((s) => s.resumen?.wallet_serial);
  const [enWallet, setEnWallet] = useState(false);
  useFocusEffect(useCallback(() => { if (serialW) setEnWallet(tienePase(serialW)); }, [serialW]));
  // Ya agregada: se abre en Wallet. Si no: se arma y se ofrece la hoja de Apple.
  const prueba = useModoPrueba();
  // `abrir`: si ya está, se abre; si no (o al «volver a agregar»), se arma y
  // se ofrece la hoja de Apple. Volver a agregar sirve si se borró o se ocultó
  // en Wallet y la app todavía la ve (usuario, 2026-10-07).
  const wallet = async ({ abrir = true } = {}) => {
    if (abrir && enWallet && abrirPase(serialW)) return;
    const enPrueba = !!resumen?.prueba && prueba.activo;
    // Directo a Wallet; por Safari si falla (2026-10-08).
    const ok = await sinBloquear(() => agregarDirecto(pedirW, enPrueba ? prueba.nivel : null));
    if (ok) setEnWallet(tienePase(serialW));
    if (ok === null && !(await agregarPorSafari(pedirW, enPrueba ? prueba.nivel : null))) {
      Alert.alert('No se pudo preparar la tarjeta', 'Revisa tu conexión e intenta de nuevo.');
    }
  };
  const { pedir, cerrar } = useSesion();
  const { resumen: crudo, cargar } = useCuenta();
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

      {/* Perfil: lo que sólo vive aquí. */}
      {conFicha ? (
        <Grupo titulo="Perfil">
          {conCodigo ? (
            <FilaAccion sf="person.text.rectangle.fill" texto="Ver mis compras, facturas y reservas" alTocar={irACompletarEntrada} />
          ) : null}
          {/* Sólo créditos fiscales (2026-10-20): sin ninguno, no hay qué ver.
              Un servidor viejo no manda `con_ccf`: ahí se ofrece igual. */}
          {!conCodigo && resumen?.con_ccf !== false ? <FilaAccion sf="doc.text.fill" texto="Mis facturas" alTocar={() => navegar('/facturas')} /> : null}
          {/* Saldo a favor (2026-10-19): lo pagado que no se entregó o un
              anticipo; vale en cualquier sucursal. El detalle, en Mis reservas. */}
          {!conCodigo && resumen?.saldo_a_favor?.total > 0 ? (
            <FilaAccion sf="dollarsign.circle.fill" color={t.color.exitoTexto}
              texto={`Saldo a favor: ${dolares(resumen.saldo_a_favor.total)}${resumen.saldo_a_favor.vence ? ` · hasta el ${fecha(resumen.saldo_a_favor.vence)}` : ''} · úsalo en cualquier sucursal`}
              alTocar={() => navegar('/reservas')} />
          ) : null}
          {/* Mis créditos (2026-10-15): sólo si debe algo; la insignia, los vencidos. */}
          {!conCodigo && resumen?.creditos?.pendientes > 0 ? (
            <FilaAccion sf="creditcard.fill" texto="Mis créditos" insignia={Number(resumen.creditos.vencidos) || 0}
              alTocar={() => navegar('/creditos')} />
          ) : null}
          {!conCodigo ? <FilaMayorista m={resumen.mayorista} pedir={pedir} alCambiar={() => cargar({ forzar: true })} /> : null}
          {resumen?.wallet_serial && walletDisponible() && enWallet ? (
            <FilaAccion sf="wallet.pass.fill" texto="Ver mi tarjeta en Apple Wallet" alTocar={() => wallet()} />
          ) : null}
          {resumen?.wallet_serial && walletDisponible() && enWallet ? (
            <FilaAccion sf="arrow.clockwise" texto="Volver a agregar la tarjeta a Wallet" alTocar={() => wallet({ abrir: false })} />
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
      </Grupo>
      ) : null}

      {/* El chat con la farmacia (2026-10-12), con los sin leer. Sin ficha
          todavía no hay Inicio con sus accesos: las sucursales van aquí. */}
      {conFicha ? (
        <Grupo titulo="Ayuda y chat" pie="Te responde el equipo de Farmacia Salud en el horario de las sucursales.">
          {!conCodigo ? (
            <FilaAccion sf="bubble.left.and.bubble.right.fill" texto="Pregúntale a la farmacia" insignia={Number(resumen?.chat_sin_leer) || 0}
              alTocar={() => navegar('/chat')} />
          ) : null}
          {/* La guía del primer inicio y las novedades de esta versión, otra vez (2026-10-14). */}
          <FilaAccion sf="questionmark.circle" texto="Cómo funciona la app" alTocar={() => navegar('/guia')} />
          <FilaAccion sf="sparkles" texto="Novedades" alTocar={() => usePresentacion.getState().abrirNovedades()} />
        </Grupo>
      ) : (
        <Grupo titulo="Ayuda">
          <FilaAccion sf="mappin.and.ellipse" texto="Nuestras sucursales" alTocar={() => navegar('/sucursales')} />
          <FilaAccion sf="questionmark.circle" texto="Cómo funciona la app" alTocar={() => navegar('/guia')} />
          <FilaAccion sf="sparkles" texto="Novedades" alTocar={() => usePresentacion.getState().abrirNovedades()} />
        </Grupo>
      )}

      <Grupo titulo="Legal y privacidad" pie={completa ? 'Si quitas el programa, tu saldo queda en pausa; no se pierde.' : undefined}>
        {completa ? (
          <FilaInterruptor titulo="Programa de puntos" detalle={c?.textos?.programa}
            valor={valorDe('programa', c?.programa !== false)} alCambiar={(v) => permiso('programa', v)} color={t.color.magenta} />
        ) : null}
        <FilaAccion sf="doc.text.fill" texto="Reglamento del programa" alTocar={() => navegar('/legal?doc=reglamento')} />
        <FilaAccion sf="hand.raised.fill" texto="Aviso de privacidad" alTocar={() => navegar('/legal?doc=privacidad')} />
      </Grupo>

      {resumen?.prueba ? <PanelDePrueba prueba={prueba} pedir={pedir} /> : null}

      <Grupo>
        <FilaAccion texto="Cerrar sesión" flecha={false} alTocar={salir} />
        <FilaAccion texto="Borrar mi cuenta" color={colorSistema.rojo} alTocar={borrar} />
      </Grupo>
    </Formulario>
  );
}

// '2026-11-03' → '3/11' (la fecha sola, sin zona: es un día del calendario).
const fechaCorta = (iso) => { const [, mm, dd] = String(iso).slice(0, 10).split('-'); return dd && mm ? `${Number(dd)}/${Number(mm)}` : String(iso); };

// Cliente Mayorista (Condiciones §2, Procedimiento §3): se pide desde aquí y
// lo decide Administración en el portal en 5 días hábiles.
function FilaMayorista({ m, pedir, alCambiar }) {
  const estado = m?.estado;
  if (estado === 'aprobado') {
    // Un cambio avisado (2026-10-19, Condiciones §6): rige 15 días después.
    const cambio = m.retiro_programado ? ` · termina el ${fechaCorta(m.retiro_programado)}`
      : m.precio_programado_el ? ` · pasa a Mayoreo el ${fechaCorta(m.precio_programado_el)}` : '';
    return <FilaAccion sf="diamond.fill" texto={`Cliente Mayorista · ${m.precio === 'mayoreo_plus' ? 'Mayoreo Plus' : 'Mayoreo'}${cambio}`} flecha={false} alTocar={() => navegar('/puntos')} />;
  }
  if (estado === 'solicitado') {
    return <FilaAccion sf="clock.fill" texto="Cliente Mayorista: solicitud en revisión" flecha={false}
      alTocar={() => Alert.alert('Solicitud en revisión', 'Administración la responde en un máximo de 5 días hábiles. Te avisamos aquí.')} />;
  }
  const pedirla = () => Alert.alert('Ser Cliente Mayorista',
    'Es para quien compra en volumen y de forma habitual. Para pedirlo necesitas haber comprado en promedio $100 al mes en los últimos 3 meses, o una compra de $500 en una sola factura, y tu ficha completa (documento y teléfono).\n\nLa empresa responde en 5 días hábiles.',
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
        <FilaAccion sf="xmark.circle" texto={`Solicitud no aprobada${m?.motivo ? `: ${m.motivo}` : ''}`} flecha={false}
          alTocar={() => Alert.alert('Solicitud no aprobada', m?.motivo ? `Motivo: ${m.motivo}\n\nPuedes volver a pedirlo cuando quieras.` : 'Puedes volver a pedirlo cuando quieras.')} />
        <FilaAccion sf="diamond" texto="Volver a solicitar ser Cliente Mayorista" alTocar={pedirla} />
      </>
    );
  }
  return <FilaAccion sf="diamond" texto="Quiero ser Cliente Mayorista" alTocar={pedirla} />;
}

// El panel del modo de prueba (2026-10-07; ordenado en subgrupos y ampliado
// para usar la app como DEMO el 2026-10-20). Sólo lo ve la cuenta de prueba
// (`resumen.prueba`, la fila `modo_prueba` en el servidor): la del revisor de
// las tiendas tiene muestras pero no esto. Todo lo nuevo vive en la memoria
// del teléfono (lib/demo.js) y no escribe nada en el servidor; sólo «Avisos al
// teléfono» —que ya existía— le pide al servidor que mande el aviso.
function PanelDePrueba({ prueba, pedir }) {
  const t = useTema();
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
          <Text style={{ fontSize: 13, color: colorSistema.texto2 }}>Saldo a favor de muestra ($14.75 de una reserva pagada en línea que venció; vale 60 días)</Text>
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
