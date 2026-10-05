// Cuenta: permisos, avisos, reglamento, cerrar sesión y borrar la cuenta
// (Apple lo exige dentro de la app, 5.1.1(v)). Forma de Ajustes: grupos con
// interruptores del sistema y acciones en filas, la destructiva en rojo.
import { useCallback, useState } from 'react';
import { Alert, Linking, Pressable, Text } from 'react-native';
import { useFocusEffect } from 'expo-router';
import { colorSistema, FilaInterruptor, FilaTexto, Formulario, Grupo } from '../../../componentes/sistema';
import { Aviso } from '../../../componentes/ui';
import { useSesion } from '../../../lib/sesion';
import { useCuenta } from '../../../lib/cuenta';
import { pedirTokenDeAvisos } from '../../../lib/avisos';
import { nombrePropio } from '../../../lib/formato';
import { useTema } from '../../../tema/tema';

const REGLAMENTO = 'https://portal.farmasalud.lat/reglamento-puntos';

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
  const { pedir, cerrar } = useSesion();
  const { resumen, cargar } = useCuenta();
  const [mensaje, setMensaje] = useState(null);

  useFocusEffect(useCallback(() => { if (!resumen) cargar(); }, [resumen, cargar]));

  const c = resumen?.consentimiento;

  async function permiso(campo, valor) {
    setMensaje(null);
    const r = await pedir('permisos', { [campo]: valor });
    if (!r?.ok) setMensaje(r?.mensaje ?? 'No se pudo guardar.');
    await cargar();
  }

  async function avisos(valor) {
    setMensaje(null);
    let push_token = null;
    if (valor) {
      const r = await pedirTokenDeAvisos();
      if (r.error) { setMensaje(r.error); return; }
      push_token = r.token;
    }
    const r = await pedir('avisos', { acepta: valor, push_token });
    if (!r?.ok) setMensaje(r?.mensaje ?? 'No se pudo guardar.');
    await cargar();
  }

  function salir() {
    Alert.alert('¿Cerrar sesión?', 'Para volver a entrar vas a necesitar tu DUI y teléfono, o el código de tu ticket.', [
      { text: 'Cancelar', style: 'cancel' },
      { text: 'Cerrar sesión', style: 'destructive', onPress: async () => { await pedir('salir'); await cerrar(); } },
    ]);
  }

  function borrar() {
    Alert.alert(
      'Borrar mi cuenta',
      'Se cierra la sesión en todos tus teléfonos y dejas de recibir avisos. Tu historial de compras se conserva porque la ley lo exige para las facturas.',
      [
        { text: 'Cancelar', style: 'cancel' },
        { text: 'Borrar cuenta', style: 'destructive', onPress: () => confirmarBorrado(false) },
        { text: 'Borrar y salir del programa', style: 'destructive', onPress: () => confirmarBorrado(true) },
      ],
    );
  }

  async function confirmarBorrado(retirar) {
    const r = await pedir('borrar_cuenta', { retirar_permisos: retirar });
    if (r?.ok) await cerrar();
    else setMensaje(r?.mensaje ?? 'No se pudo borrar la cuenta.');
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
            valor={c?.programa !== false} alCambiar={(v) => permiso('programa', v)} color={t.color.magenta} />
          <FilaInterruptor titulo="Promociones" detalle={c?.textos?.promociones}
            valor={c?.promociones === true} alCambiar={(v) => permiso('promociones', v)} color={t.color.magenta} />
        </Grupo>
      ) : null}

      <Grupo pie="Ofertas nuevas y puntos por vencer.">
        <FilaInterruptor titulo="Avisos en este teléfono" valor={resumen?.acepta_avisos === true}
          alCambiar={avisos} color={t.color.magenta} />
      </Grupo>

      <Grupo>
        <FilaAccion texto="Reglamento del programa" color={t.color.magentaTexto} alTocar={() => Linking.openURL(REGLAMENTO)} />
      </Grupo>

      <Grupo>
        <FilaAccion texto="Cerrar sesión" color={t.color.magentaTexto} alTocar={salir} />
        <FilaAccion texto="Borrar mi cuenta" color={colorSistema.rojo} alTocar={borrar} />
      </Grupo>
    </Formulario>
  );
}
