// Cuenta: permisos, avisos, cerrar sesión y borrar la cuenta (Apple lo exige
// dentro de la app, 5.1.1(v)).
import { useCallback, useState } from 'react';
import { Alert, Linking, Switch, View } from 'react-native';
import { useFocusEffect } from 'expo-router';
import { Aviso, Boton, Pantalla, Tarjeta, Texto, Titulo } from '../../../componentes/ui';
import { useSesion } from '../../../lib/sesion';
import { useCuenta } from '../../../lib/cuenta';
import { pedirTokenDeAvisos } from '../../../lib/avisos';
import { useTema } from '../../../tema/tema';

const REGLAMENTO = 'https://portal.farmasalud.lat/reglamento-puntos';

export default function Cuenta() {
  const t = useTema();
  const { pedir, cerrar } = useSesion();
  const { resumen, cargar } = useCuenta();
  const [mensaje, setMensaje] = useState(null);
  const [ocupado, setOcupado] = useState(false);

  useFocusEffect(useCallback(() => { if (!resumen) cargar(); }, [resumen, cargar]));

  const c = resumen?.consentimiento;

  async function permiso(campo, valor) {
    setMensaje(null);
    const r = await pedir('permisos', { [campo]: valor });
    if (!r?.ok) setMensaje({ tipo: 'error', texto: r?.mensaje ?? 'No se pudo guardar.' });
    await cargar();
  }

  async function avisos(valor) {
    setMensaje(null);
    let push_token = null;
    if (valor) {
      const r = await pedirTokenDeAvisos();
      if (r.error) { setMensaje({ tipo: 'aviso', texto: r.error }); return; }
      push_token = r.token;
    }
    const r = await pedir('avisos', { acepta: valor, push_token });
    if (!r?.ok) setMensaje({ tipo: 'error', texto: r?.mensaje ?? 'No se pudo guardar.' });
    await cargar();
  }

  async function salir() {
    await pedir('salir');
    await cerrar();
  }

  function borrar() {
    Alert.alert(
      'Borrar mi cuenta',
      'Se cierra la sesión en todos tus teléfonos y dejas de recibir avisos. Tu historial de compras se conserva porque la ley lo exige para las facturas. ¿Quieres también salir del programa de puntos y de las promociones?',
      [
        { text: 'Cancelar', style: 'cancel' },
        { text: 'Borrar cuenta', style: 'destructive', onPress: () => confirmarBorrado(false) },
        { text: 'Borrar y salir del programa', style: 'destructive', onPress: () => confirmarBorrado(true) },
      ],
    );
  }

  async function confirmarBorrado(retirar) {
    setOcupado(true);
    const r = await pedir('borrar_cuenta', { retirar_permisos: retirar });
    setOcupado(false);
    if (r?.ok) await cerrar();
    else setMensaje({ tipo: 'error', texto: r?.mensaje ?? 'No se pudo borrar la cuenta.' });
  }

  return (
    <Pantalla>
      {resumen?.nombre ? <Titulo>{resumen.nombre}</Titulo> : null}
      {mensaje ? <Aviso tipo={mensaje.tipo}>{mensaje.texto}</Aviso> : null}

      {resumen && !resumen.pendiente ? (
        <Tarjeta>
          <Titulo>Permisos</Titulo>
          <Interruptor titulo="Programa de puntos" detalle={c?.textos?.programa}
            valor={c?.programa !== false} alCambiar={(v) => permiso('programa', v)} />
          <Interruptor titulo="Promociones" detalle={c?.textos?.promociones}
            valor={c?.promociones === true} alCambiar={(v) => permiso('promociones', v)} />
        </Tarjeta>
      ) : null}

      <Tarjeta>
        <Interruptor titulo="Avisos en este teléfono" detalle="Ofertas nuevas y puntos por vencer."
          valor={resumen?.acepta_avisos === true} alCambiar={avisos} />
      </Tarjeta>

      <Tarjeta>
        <Texto onPress={() => Linking.openURL(REGLAMENTO)} estilo={{ color: t.color.magentaTexto, fontWeight: '600', paddingVertical: 8 }}>
          Reglamento del programa
        </Texto>
      </Tarjeta>

      <View style={{ gap: 12, marginTop: 8 }}>
        <Boton tipo="secundario" alTocar={salir}>Cerrar sesión</Boton>
        <Boton tipo="peligro" alTocar={borrar} cargando={ocupado}>Borrar mi cuenta</Boton>
      </View>
    </Pantalla>
  );
}

function Interruptor({ titulo, detalle, valor, alCambiar }) {
  const t = useTema();
  return (
    <View style={{ flexDirection: 'row', alignItems: 'center', gap: 12, paddingVertical: 6 }}>
      <View style={{ flex: 1, gap: 2 }}>
        <Texto estilo={{ fontWeight: '600' }}>{titulo}</Texto>
        {detalle ? <Texto nivel={3} estilo={{ fontSize: 13, lineHeight: 18 }}>{detalle}</Texto> : null}
      </View>
      <Switch value={valor} onValueChange={alCambiar} trackColor={{ true: t.color.magenta }} />
    </View>
  );
}
