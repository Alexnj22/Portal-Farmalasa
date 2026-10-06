// Cuenta: permisos, avisos, reglamento, cerrar sesión y borrar la cuenta
// (Apple lo exige dentro de la app, 5.1.1(v)). Forma de Ajustes: grupos con
// interruptores del sistema y acciones en filas, la destructiva en rojo.
import { useCallback, useEffect, useState } from 'react';
import { Alert, Linking, Pressable, Text } from 'react-native';
import { router, useFocusEffect } from 'expo-router';
import { colorSistema, FilaInterruptor, FilaTexto, Formulario, Grupo } from '../../../componentes/sistema';
import { Aviso } from '../../../componentes/ui';
import { useSesion } from '../../../lib/sesion';
import { useCuenta } from '../../../lib/cuenta';
import { pedirTokenDeAvisos } from '../../../lib/avisos';
import * as WebBrowser from 'expo-web-browser';
import { abrirPase, agregarPase, tienePase, walletDisponible } from '../../../modules/wallet';
import { nombreBiometria, useBloqueo } from '../../../lib/bloqueo';
import { nombrePropio } from '../../../lib/formato';
import { useTema } from '../../../tema/tema';

const REGLAMENTO = 'https://portal.farmasalud.lat/reglamento-puntos';
// Apple pide el enlace a la política de privacidad DENTRO de la app (5.1.1(i)):
// la app pide el DUI, que es un dato sensible.
const PRIVACIDAD = 'https://portal.farmasalud.lat/privacidad.html';

/** Una fila que se toca, como «Cerrar sesión» en Ajustes. */
function FilaAccion({ texto, color, alTocar }) {
  return (
    <Pressable accessibilityRole="button" onPress={alTocar}
      style={({ pressed }) => ({ opacity: pressed ? 0.5 : 1 })}>
      <FilaTexto color={color}>{texto}</FilaTexto>
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
  const wallet = async () => {
    if (enWallet && abrirPase(serialW)) return;
    const r = await pedirW('wallet_pase');
    if (!r?.ok || !r.pase) { Alert.alert('No se pudo preparar la tarjeta', r?.mensaje ?? 'Revisa tu conexión e intenta de nuevo.'); return; }
    try { if (await agregarPase(r.pase)) setEnWallet(true); } catch { /* cerrada */ }
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
    if (r?.ok) await cerrar();
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
          <FilaAccion texto="Invitar a un amigo · 50 puntos" color={t.color.magentaTexto} alTocar={() => router.push('/invitar')} />
        ) : null}
        {resumen && !resumen.pendiente ? (
          <FilaAccion texto="Mis reservas" color={t.color.magentaTexto} alTocar={() => router.push('/reservas')} />
        ) : null}
        <FilaAccion texto="Nuestras sucursales" color={t.color.magentaTexto} alTocar={() => router.push('/sucursales')} />
        {resumen?.wallet_serial && walletDisponible() ? (
          <FilaAccion texto={enWallet ? 'Ver mi tarjeta en Apple Wallet' : 'Agregar mi tarjeta a Apple Wallet'}
            color={t.color.magentaTexto} alTocar={wallet} />
        ) : null}
      </Grupo>

      <Grupo>
        <FilaAccion texto="Reglamento del programa" color={t.color.magentaTexto} alTocar={() => WebBrowser.openBrowserAsync(REGLAMENTO).catch(() => {})} />
        <FilaAccion texto="Aviso de privacidad" color={t.color.magentaTexto} alTocar={() => WebBrowser.openBrowserAsync(PRIVACIDAD).catch(() => {})} />
      </Grupo>

      <Grupo>
        <FilaAccion texto="Cerrar sesión" color={t.color.magentaTexto} alTocar={salir} />
        <FilaAccion texto="Borrar mi cuenta" color={colorSistema.rojo} alTocar={borrar} />
      </Grupo>
    </Formulario>
  );
}
