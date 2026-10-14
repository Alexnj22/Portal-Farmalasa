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
import { useCallback, useEffect, useState } from 'react';
import * as Haptics from 'expo-haptics';
import { ActionSheetIOS, Alert, Platform, Text, View } from 'react-native';
import Presionable from '../../../componentes/Presionable';
import { useFocusEffect } from 'expo-router';
import { colorSistema, FilaInterruptor, FilaTexto, Formulario, Grupo } from '../../../componentes/sistema';
import { Aviso, ESPACIO_BURBUJA } from '../../../componentes/ui';
import { useSesion } from '../../../lib/sesion';
import { useCuenta } from '../../../lib/cuenta';
import { pedirTokenDeAvisos, recordarAvisos } from '../../../lib/avisos';
import { abrirPase, agregarDirecto, agregarPorSafari, tienePase, walletDisponible } from '../../../modules/wallet';
import { conBiometria, nombreBiometria, rotuloBiometria, sinBloquear, useBloqueo } from '../../../lib/bloqueo';
import { olvidarEntrada } from '../../../lib/entradaGuardada';
import { NIVELES_PRUEBA, useModoPrueba } from '../../../lib/prueba';
import Segmentos from '../../../componentes/Segmentos';
import { nombrePropio } from '../../../lib/formato';
import { useTema } from '../../../tema/tema';
import Icono from '../../../componentes/Icono';
import { navegar } from '../../../lib/navegar';
import AvatarNivel, { rotuloNivel } from '../../../componentes/AvatarNivel';
import { refrescarFotoPerfil, useFotoPerfil } from '../../../lib/fotoPerfil';
import { rangoReal } from '../../../componentes/Mayorista';
import { subirFoto } from '../../../lib/fotos';
import { usarVistaPreviaFoto } from '../../../componentes/VistaPreviaFoto';


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
  const { resumen, cargar } = useCuenta();
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
  useFocusEffect(useCallback(() => {
    if (!conFicha || !resumen?.codigo) return;
    refrescarFotoPerfil(resumen.codigo);
  }, [conFicha, resumen?.codigo]));
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
    const f = await vistaPrevia.elegir({ titulo: 'Tu foto de perfil', mensaje: 'La ve el equipo de la farmacia cuando chateas con nosotros.', circular: true });
    if (!f) return;
    setSubiendo(true);
    const s = await subirFoto(pedir, 'perfil_subir_url', {}, f.uri);
    const r = s.ok ? await pedir('perfil_confirmar', { ruta: s.ruta }) : s;
    setSubiendo(false);
    if (r?.ok) ponerFoto({ url: r.foto_url ?? f.uri, quitada: false });
    else Alert.alert('No se pudo guardar la foto', r?.mensaje ?? 'Revisa tu conexión e intenta de nuevo.');
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
    if (valor) {
      // Nunca lanza hacia el botón (2026-10-12): un fallo del sistema es un mensaje.
      const r = await pedirTokenDeAvisos().catch(() => ({ error: 'No se pudieron activar los avisos. Intenta más tarde.' }));
      if (r.error) { setMensaje(r.error); return; }
      push_token = r.token;
    }
    setGuardando('avisos');
    setLocal((x) => ({ ...x, avisos: valor }));
    const r = await pedir('avisos', { acepta: valor, push_token });
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
  // las sesiones, apaga los avisos y borra el pre-registro; la FICHA no se
  // borra (es un registro fiscal) y con ella quedan los puntos. Con
  // `retirar_permisos` además guarda programa = no y promociones = no
  // (`puntos_guardar_consentimiento`): el Reglamento dice que entonces deja de
  // acumular y su saldo queda retenido —no vence ni se canjea— hasta que vuelva.
  function borrar() {
    Alert.alert(
      '¿Borrar tu cuenta de la app?',
      'Se cierra la sesión en todos tus teléfonos, dejas de recibir avisos y se borran los datos de tu registro en la app.\n\n'
        + 'Tu ficha y tus puntos siguen en la farmacia: si compras con tu DUI sigues acumulando, y puedes volver a entrar cuando quieras.\n\n'
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
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 14, marginHorizontal: 24 }}>
          {conFicha ? (
            <Presionable onPress={cambiarFoto} accessibilityRole="button" accessibilityLabel={foto.url ? 'Cambiar tu foto de perfil' : 'Agregar una foto de perfil'}
              style={({ pressed }) => ({ transform: [{ scale: pressed ? 0.95 : 1 }] })}>
              <AvatarNivel nombre={resumen.nombre} material={materialAvatar} equipo={equipoAvatar} uri={foto.url} clave={foto.clave} tam={68} atenuado={foto.cargando} />
              <View style={{ position: 'absolute', right: -2, bottom: -2, width: 24, height: 24, borderRadius: 12, alignItems: 'center', justifyContent: 'center', backgroundColor: t.color.magenta }}>
                <Icono sf="camera.fill" respaldo="+" tam={11} color="#FFFFFF" />
              </View>
            </Presionable>
          ) : null}
          <View style={{ flex: 1, gap: 2 }}>
            <Text style={{ fontSize: 22, fontWeight: '700', color: colorSistema.texto }}>
              {nombrePropio(resumen.nombre)}
            </Text>
            {nivelTexto ? (
              <Text style={{ fontSize: 14, fontWeight: '600', color: colorSistema.texto2 }}>{nivelTexto}</Text>
            ) : null}
            {conFicha && foto.quitada ? (
              <Text style={{ fontSize: 13, color: colorSistema.texto2 }}>Quitamos tu foto de perfil porque no correspondía. Puedes subir otra.</Text>
            ) : conFicha && !foto.url ? (
              <Text style={{ fontSize: 13, color: colorSistema.texto3 }}>Toca para agregar tu foto (opcional)</Text>
            ) : null}
          </View>
        </View>
      ) : null}
      {mensaje ? <Aviso>{mensaje}</Aviso> : null}

      {/* Perfil: lo que sólo vive aquí. */}
      {conFicha ? (
        <Grupo titulo="Perfil">
          <FilaAccion sf="doc.text.fill" texto="Mis facturas" alTocar={() => navegar('/facturas')} />
          <FilaMayorista m={resumen.mayorista} pedir={pedir} alCambiar={() => cargar({ forzar: true })} />
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

      <Grupo titulo="Notificaciones" pie="Ofertas nuevas, puntos por vencer y tus reservas. Las promociones son las ofertas personalizadas que te mandamos.">
        <FilaInterruptor titulo="Avisos en este teléfono" valor={valorDe('avisos', resumen?.acepta_avisos === true)}
          alCambiar={avisos} color={t.color.magenta} />
        {conFicha ? (
          <FilaInterruptor titulo="Promociones" detalle={c?.textos?.promociones}
            valor={valorDe('promociones', c?.promociones === true)} alCambiar={(v) => permiso('promociones', v)} color={t.color.magenta} />
        ) : null}
      </Grupo>

      {/* El chat con la farmacia (2026-10-12), con los sin leer. Sin ficha
          todavía no hay Inicio con sus accesos: las sucursales van aquí. */}
      {conFicha ? (
        <Grupo titulo="Ayuda y chat" pie="Te responde el equipo de Farmacia Salud en el horario de las sucursales.">
          <FilaAccion sf="bubble.left.and.bubble.right.fill" texto="Pregúntale a la farmacia" insignia={Number(resumen?.chat_sin_leer) || 0}
            alTocar={() => navegar('/chat')} />
        </Grupo>
      ) : (
        <Grupo titulo="Ayuda">
          <FilaAccion sf="mappin.and.ellipse" texto="Nuestras sucursales" alTocar={() => navegar('/sucursales')} />
        </Grupo>
      )}

      <Grupo titulo="Legal y privacidad" pie={conFicha ? 'Si quitas el programa, tu saldo queda en pausa; no se pierde.' : undefined}>
        {conFicha ? (
          <FilaInterruptor titulo="Programa de puntos" detalle={c?.textos?.programa}
            valor={valorDe('programa', c?.programa !== false)} alCambiar={(v) => permiso('programa', v)} color={t.color.magenta} />
        ) : null}
        <FilaAccion sf="doc.text.fill" texto="Reglamento del programa" alTocar={() => navegar('/legal?doc=reglamento')} />
        <FilaAccion sf="hand.raised.fill" texto="Aviso de privacidad" alTocar={() => navegar('/legal?doc=privacidad')} />
      </Grupo>

      {/* Modo de prueba: sólo la cuenta de prueba. Ver la tarjeta, el nivel, el
          cupón y Wallet como cada nivel, sin comprar. */}
      {resumen?.prueba ? (
        <>
        <Grupo titulo="Modo de prueba" pie="Sólo en esta cuenta de prueba. Cambia cómo se ve la app (tarjeta, nivel, cupón y la tarjeta de Wallet que se agrega); no cambia puntos ni datos.">
          <FilaInterruptor titulo="Ver la app como otro nivel" valor={prueba.activo}
            alCambiar={(v) => prueba.poner({ activo: v })} color={t.color.magenta} />
          {prueba.activo ? (
            <View style={{ padding: 12 }}>
              <Segmentos valor={prueba.nivel} alCambiar={(n) => prueba.poner({ nivel: n })}
                opciones={NIVELES_PRUEBA.map((n) => ({ valor: n.clave, rotulo: n.clave === 'vip' ? 'Bronce' : n.nombre }))} />
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
          {prueba.activo && ['oro', 'platino'].includes(prueba.nivel) ? (
            <FilaAccion sf="arrow.counterclockwise" texto="Volver a tapar el cupón" alTocar={() => { prueba.reiniciarCupon(); navegar('/puntos'); }} />
          ) : null}
          {prueba.activo && ['oro', 'platino'].includes(prueba.nivel) ? (
            <FilaAccion sf="sparkles" texto="Ver la animación del cupón" alTocar={() => { prueba.verAnimacionCupon(); navegar('/puntos'); }} />
          ) : null}
          {prueba.activo && ['oro', 'platino'].includes(prueba.nivel) ? (
            <FilaAccion sf="checkmark.seal.fill" texto={prueba.cuponUsado ? 'Ver el cupón sin usar' : 'Ver el cupón ya usado'}
              alTocar={() => { prueba.verCuponUsado(!prueba.cuponUsado); navegar('/puntos'); }} />
          ) : null}
          <FilaAccion sf="plus.circle.fill" texto="Simular: ganar 250 puntos" alTocar={() => { prueba.simularPuntos(250); navegar('/puntos'); }} />
          <FilaAccion sf="minus.circle.fill" texto="Simular: usar 500 puntos" alTocar={() => { prueba.simularPuntos(-500); navegar('/puntos'); }} />
          <FilaAccion sf="gift.fill" texto="Ver la pantalla de cumpleaños" alTocar={() => navegar(`/puntos?cumple=${Date.now()}`)} />
          <FilaAccion sf="crown.fill" texto="Ver la pantalla de subir de nivel" alTocar={() => navegar('/puntos?nivel=1')} />
          {/* Mayoreo (2026-10-09): las pantallas de rango, precio y bienvenida; con el rango de prueba elegido arriba. */}
          {prueba.activo && prueba.mayorista ? (
            <FilaAccion sf="diamond.fill" texto="Ver la pantalla de subir de rango" alTocar={() => navegar('/puntos?rango=1')} />
          ) : null}
          {prueba.activo && prueba.mayorista ? (
            <FilaAccion sf="tag.fill" texto="Ver la pantalla de precio Mayoreo Plus" alTocar={() => navegar('/puntos?precio=1')} />
          ) : null}
          {prueba.activo && prueba.mayorista ? (
            <FilaAccion sf="sparkles" texto="Ver la bienvenida a precio de mayoreo" alTocar={() => navegar('/puntos?mayoreo=1')} />
          ) : null}
        </Grupo>
        <Grupo titulo="Avisos de prueba" pie="Llegan de verdad a este teléfono (con los avisos activados) y a la campana. Toca el aviso para ver la pantalla que abre.">
          {[['cumpleanos', 'gift.fill', 'Cumpleaños'], ['puntos', 'star.fill', 'Ganaste puntos'], ['cupon', 'ticket.fill', 'Cupón del mes'],
            ['nivel', 'crown.fill', 'Subiste de nivel'], ['rango', 'diamond.fill', 'Subiste de rango (mayoreo)'], ['precio', 'tag.fill', 'Precio Mayoreo Plus'],
            ['mayoreo', 'sparkles', 'Aprobado en mayoreo'], ['tratamiento', 'pills.fill', 'Tratamiento'], ['restado', 'minus.circle.fill', 'Usaste puntos'], ['reserva', 'bag.fill', 'Reserva lista']].map(([tipo, sf, texto]) => (
            <FilaAccion key={tipo} sf={sf} texto={`Recibir aviso: ${texto}`} flecha={false} alTocar={async () => {
              const r = await pedir('prueba_aviso', { tipo });
              Alert.alert(r?.ok ? 'Aviso enviado' : 'No se envió', r?.ok ? 'Llega en unos segundos. Bloquea el teléfono para verlo como notificación.' : (r?.mensaje ?? 'Revisa tu conexión.'));
            }} />
          ))}
        </Grupo>
        </>
      ) : null}

      <Grupo>
        <FilaAccion texto="Cerrar sesión" flecha={false} alTocar={salir} />
        <FilaAccion texto="Borrar mi cuenta" color={colorSistema.rojo} alTocar={borrar} />
      </Grupo>
    </Formulario>
  );
}

// Cliente Mayorista (Condiciones §2, Procedimiento §3): se pide desde aquí y
// lo decide Administración en el portal en 5 días hábiles.
function FilaMayorista({ m, pedir, alCambiar }) {
  const estado = m?.estado;
  if (estado === 'aprobado') {
    return <FilaAccion sf="diamond.fill" texto={`Cliente Mayorista · ${m.precio === 'mayoreo_plus' ? 'Mayoreo Plus' : 'Mayoreo'}`} flecha={false} alTocar={() => navegar('/puntos')} />;
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
  return <FilaAccion sf="diamond" texto={estado === 'rechazado' ? 'Volver a solicitar ser Cliente Mayorista' : 'Quiero ser Cliente Mayorista'} alTocar={pedirla} />;
}
