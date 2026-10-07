// Cuenta: permisos, avisos, reglamento, cerrar sesión y borrar la cuenta
// (Apple lo exige dentro de la app, 5.1.1(v)). Forma de Ajustes: grupos con
// interruptores del sistema y acciones en filas, la destructiva en rojo.
import { useCallback, useEffect, useState } from 'react';
import { Alert, Pressable, Text, View } from 'react-native';
import { useFocusEffect } from 'expo-router';
import { colorSistema, FilaInterruptor, FilaTexto, Formulario, Grupo } from '../../../componentes/sistema';
import { Aviso } from '../../../componentes/ui';
import { useSesion } from '../../../lib/sesion';
import { useCuenta } from '../../../lib/cuenta';
import { pedirTokenDeAvisos, recordarAvisos } from '../../../lib/avisos';
import { abrirPase, agregarPase, tienePase, walletDisponible } from '../../../modules/wallet';
import { nombreBiometria, useBloqueo } from '../../../lib/bloqueo';
import { olvidarEntrada } from '../../../lib/entradaGuardada';
import { NIVELES_PRUEBA, useModoPrueba } from '../../../lib/prueba';
import Segmentos from '../../../componentes/Segmentos';
import { nombrePropio } from '../../../lib/formato';
import { useTema } from '../../../tema/tema';
import Icono from '../../../componentes/Icono';
import { navegar } from '../../../lib/navegar';


/**
 * Una fila que se toca, como en Ajustes: ícono, texto en el color del sistema
 * y la flecha si lleva a otra pantalla. Sin el rosa de la marca en el texto
 * (usuario, 2026-10-06: «la letra rosa no me gusta»); el rojo sólo en lo
 * destructivo.
 */
function FilaAccion({ texto, sf, color, flecha = true, alTocar }) {
  return (
    <Pressable accessibilityRole="button" onPress={alTocar}
      style={({ pressed }) => ({ flexDirection: 'row', alignItems: 'center', paddingLeft: sf ? 16 : 0, paddingRight: 16,
        backgroundColor: pressed ? colorSistema.separador : 'transparent' })}>
      {sf ? <Icono sf={sf} respaldo="" tam={18} color={color ?? colorSistema.texto2} /> : null}
      <View style={{ flex: 1 }}><FilaTexto color={color}>{texto}</FilaTexto></View>
      {flecha && !color ? <Icono sf="chevron.right" respaldo="›" tam={13} color={colorSistema.texto3} /> : null}
    </Pressable>
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
    const r = await pedirW('wallet_pase', enPrueba ? { nivel_prueba: prueba.nivel } : {});
    if (!r?.ok || !r.pase) { Alert.alert('No se pudo preparar la tarjeta', r?.mensaje ?? 'Revisa tu conexión e intenta de nuevo.'); return; }
    try { await agregarPase(r.pase); } catch { /* cerrada */ }
    setEnWallet(tienePase(serialW));
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
      const r = await pedirTokenDeAvisos();
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

  // Una sola opción, con el texto claro. Salir del programa de puntos NO va
  // acá: ya es el interruptor de Permisos, y ponerlo dos veces confundía
  // (usuario, 2026-10-05: «¿por qué está borrar y borrar y salir de puntos?»).
  function borrar() {
    Alert.alert(
      '¿Borrar tu cuenta de la app?',
      'Se cierra la sesión en todos tus teléfonos y dejas de recibir avisos. Tus puntos no se pierden: si vuelves a comprar con tu DUI sigues acumulando, y puedes volver a entrar cuando quieras.',
      [
        { text: 'Cancelar', style: 'cancel' },
        { text: 'Borrar cuenta', style: 'destructive', onPress: () => confirmarBorrado() },
      ],
    );
  }

  async function confirmarBorrado() {
    const r = await pedir('borrar_cuenta');
    if (r?.ok) { await olvidarEntrada(); await cerrar(); }
    else Alert.alert('No se pudo borrar la cuenta', r?.mensaje ?? 'Revisa tu conexión e intenta de nuevo.');
  }

  return (
    <Formulario>
      {resumen?.nombre ? (
        <Text style={{ fontSize: 22, fontWeight: '700', color: colorSistema.texto, marginHorizontal: 32 }}>
          {nombrePropio(resumen.nombre)}
        </Text>
      ) : null}
      {mensaje ? <Aviso>{mensaje}</Aviso> : null}

      {resumen && !resumen.pendiente ? (
        <Grupo titulo="Permisos" pie="Si quitas el programa, tu saldo queda en pausa; no se pierde.">
          <FilaInterruptor titulo="Programa de puntos" detalle={c?.textos?.programa}
            valor={valorDe('programa', c?.programa !== false)} alCambiar={(v) => permiso('programa', v)} color={t.color.magenta} />
          <FilaInterruptor titulo="Promociones" detalle={c?.textos?.promociones}
            valor={valorDe('promociones', c?.promociones === true)} alCambiar={(v) => permiso('promociones', v)} color={t.color.magenta} />
        </Grupo>
      ) : null}

      {biometria ? (
        <Grupo pie={`Pide ${biometria} al abrir la app y al volver después de un rato, para que nadie más vea tu saldo ni tu código.`}>
          <FilaInterruptor titulo={`Bloquear con ${biometria}`} valor={bloqueoActivo}
            alCambiar={async (v) => {
              if (!v) { await apagarBloqueo(); return; }
              if (!(await encenderBloqueo())) Alert.alert(`No se activó ${biometria}`, 'Para activarlo hay que confirmar con tu cara o tu huella.');
            }} color={t.color.magenta} />
        </Grupo>
      ) : null}

      <Grupo pie="Ofertas nuevas y puntos por vencer.">
        <FilaInterruptor titulo="Avisos en este teléfono" valor={valorDe('avisos', resumen?.acepta_avisos === true)}
          alCambiar={avisos} color={t.color.magenta} />
      </Grupo>

      <Grupo>
        {resumen && !resumen.pendiente ? (
          <FilaAccion sf="person.2.fill" texto="Invitar a un amigo · 50 puntos" alTocar={() => navegar('/invitar')} />
        ) : null}
        {resumen && !resumen.pendiente ? (
          <FilaAccion sf="bag.fill" texto="Mis reservas" alTocar={() => navegar('/reservas')} />
        ) : null}
        <FilaAccion sf="mappin.and.ellipse" texto="Nuestras sucursales" alTocar={() => navegar('/sucursales')} />
        {resumen?.wallet_serial && walletDisponible() ? (
          <FilaAccion sf="wallet.pass.fill" texto={enWallet ? 'Ver mi tarjeta en Apple Wallet' : 'Agregar mi tarjeta a Apple Wallet'}
            alTocar={() => wallet()} />
        ) : null}
        {resumen?.wallet_serial && walletDisponible() && enWallet ? (
          <FilaAccion sf="arrow.clockwise" texto="Volver a agregar la tarjeta a Wallet" alTocar={() => wallet({ abrir: false })} />
        ) : null}
      </Grupo>

      {/* Modo de prueba: sólo la cuenta de prueba. Ver la tarjeta, el nivel, el
          cupón y Wallet como cada nivel, sin comprar. */}
      {resumen?.prueba ? (
        <Grupo titulo="Modo de prueba" pie="Sólo en esta cuenta de prueba. Cambia cómo se ve la app (tarjeta, nivel, cupón y la tarjeta de Wallet que se agrega); no cambia puntos ni datos.">
          <FilaInterruptor titulo="Ver la app como otro nivel" valor={prueba.activo}
            alCambiar={(v) => prueba.poner({ activo: v })} color={t.color.magenta} />
          {prueba.activo ? (
            <View style={{ padding: 12 }}>
              <Segmentos valor={prueba.nivel} alCambiar={(n) => prueba.poner({ nivel: n })}
                opciones={NIVELES_PRUEBA.map((n) => ({ valor: n.clave, rotulo: n.clave === 'vip' ? 'VIP' : n.nombre }))} />
            </View>
          ) : null}
        </Grupo>
      ) : null}

      <Grupo>
        <FilaAccion sf="doc.text.fill" texto="Reglamento del programa" alTocar={() => navegar('/legal?doc=reglamento')} />
        <FilaAccion sf="hand.raised.fill" texto="Aviso de privacidad" alTocar={() => navegar('/legal?doc=privacidad')} />
      </Grupo>

      <Grupo>
        <FilaAccion texto="Cerrar sesión" flecha={false} alTocar={salir} />
        <FilaAccion texto="Borrar mi cuenta" color={colorSistema.rojo} alTocar={borrar} />
      </Grupo>
    </Formulario>
  );
}
