// Unirse desde la app. No crea la ficha: deja un pre-registro que se completa
// en la primera compra en sala (ver el encabezado de `app-clientes`). Mientras
// tanto, la persona ya entra y ve las ofertas.
//
// Forma del sistema: formulario agrupado y los permisos como interruptores
// (iOS no tiene casillas de verificación).
import { useEffect, useState } from 'react';
import { useLocalSearchParams } from 'expo-router';
import { Text } from 'react-native';
import * as Device from 'expo-device';
import { BotonSistema, colorSistema, FilaCampo, FilaInterruptor, Formulario, Grupo } from '../componentes/sistema';
import { Aviso } from '../componentes/ui';
import { llamar } from '../lib/api';
import { plataforma, useSesion } from '../lib/sesion';
import { useTema } from '../tema/tema';
import { documentoEscrito, fechaDeNacimiento } from '../lib/formato';
import FechaNacimiento from '../componentes/FechaNacimiento';
import { useBloqueo } from '../lib/bloqueo';
import { navegar } from '../lib/navegar';

export default function Registro() {
  const t = useTema();
  const abrir = useSesion((s) => s.abrir);
  const { ref } = useLocalSearchParams();
  const [f, setF] = useState({ nombre: '', documento: '', telefono: '', email: '', fecha_nacimiento: '', referido: String(ref ?? '').toUpperCase().slice(0, 6) });
  const [programa, setPrograma] = useState(false);
  const [promos, setPromos] = useState(false);
  const [textos, setTextos] = useState(null);
  const [error, setError] = useState(null);
  const [enviando, setEnviando] = useState(false);
  const cambiar = (k) => (v) => setF((x) => ({ ...x, [k]: v }));

  // Los textos de los permisos vienen del servidor: lo que se archiva como
  // prueba es el texto que la persona tuvo delante (Art. 27 c). Sin señal, se
  // dice y se puede reintentar: antes «Unirme» quedaba apagado sin explicación.
  const [sinTextos, setSinTextos] = useState(false);
  const pedirTextos = () => {
    setSinTextos(false);
    llamar('textos').then((r) => (r?.ok ? setTextos(r.textos) : setSinTextos(true)));
  };
  useEffect(() => { pedirTextos(); }, []);

  // '' = no la dio (es opcional); null = la escribió mal, y se dice.
  const nacimiento = fechaDeNacimiento(f.fecha_nacimiento);
  const fechaMala = nacimiento === null;

  const listo = f.nombre.trim().length >= 3 && f.documento.length >= 7
    && f.telefono.replace(/\D/g, '').length >= 8 && programa && !!textos && !fechaMala;

  async function enviar() {
    if (!listo || enviando) return;
    setError(null);
    setEnviando(true);
    const r = await llamar('registrar', {
      ...f, fecha_nacimiento: nacimiento || null, acepta_programa: programa, acepta_promociones: promos,
      plataforma, dispositivo: Device.modelName ?? null,
    });
    setEnviando(false);
    if (r?.ok && r.token) { useBloqueo.setState({ bloqueada: false }); await abrir(r.token); }
    else setError(r?.mensaje ?? 'No se pudo completar el registro.');
  }

  return (
    <Formulario>
      <Grupo titulo="Tus datos" pie="En tu próxima compra en sala te pedimos el DUI para completar tu ficha. Desde esa compra empiezas a acumular.">
        <FilaCampo placeholder="Nombre completo" value={f.nombre} onChangeText={cambiar('nombre')} autoCapitalize="words" textContentType="name" />
        <FilaCampo placeholder="DUI" value={f.documento} autoCorrect={false}
          keyboardType="number-pad"
          onChangeText={(v) => cambiar('documento')(documentoEscrito(v))} />
        <FilaCampo placeholder="Teléfono" value={f.telefono} keyboardType="phone-pad" textContentType="telephoneNumber"
          onChangeText={(v) => cambiar('telefono')(v.replace(/[^\d ]/g, '').slice(0, 9))} />
      </Grupo>
      <Grupo titulo="Opcional" pie={fechaMala ? 'Esa fecha no existe. Escríbela como DD/MM/AAAA.' : 'La fecha es para tu regalo de cumpleaños.'}>
        <FilaCampo placeholder="Correo" value={f.email} onChangeText={cambiar('email')} keyboardType="email-address" autoCapitalize="none" textContentType="emailAddress" />
        <FechaNacimiento valor={f.fecha_nacimiento} alCambiar={cambiar('fecha_nacimiento')} />
      </Grupo>
      <Grupo titulo="¿Te invitaron?" pie="Escribe el código de quien te invitó: con tu primera compra de $10 o más, los dos ganan 50 puntos.">
        <FilaCampo placeholder="Código de invitación" value={f.referido} autoCapitalize="characters" autoCorrect={false}
          onChangeText={(v) => cambiar('referido')(v.toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 6))} />
      </Grupo>
      <Grupo titulo="Tus permisos" pie="El programa es necesario para acumular. Las promociones son opcionales y las puedes quitar cuando quieras.">
        <FilaInterruptor titulo="Programa de puntos" detalle={textos?.programa} valor={programa} alCambiar={setPrograma} color={t.color.magenta} />
        <FilaInterruptor titulo="Promociones" detalle={textos?.promociones} valor={promos} alCambiar={setPromos} color={t.color.magenta} />
      </Grupo>
      {/* Antes de aceptar, que se pueda leer lo que se acepta, dentro de la app. */}
      <Text style={{ fontSize: 14, lineHeight: 20, color: colorSistema.texto2, marginHorizontal: 32 }}>
        Lee el{' '}
        <Text onPress={() => navegar('/legal?doc=reglamento')}
          style={{ color: colorSistema.texto, fontWeight: '700', textDecorationLine: 'underline' }} accessibilityRole="link">reglamento del programa</Text>
        {' '}y el{' '}
        <Text onPress={() => navegar('/legal?doc=privacidad')}
          style={{ color: colorSistema.texto, fontWeight: '700', textDecorationLine: 'underline' }} accessibilityRole="link">aviso de privacidad</Text>.
      </Text>
      {sinTextos ? (
        <Aviso tipo="aviso">No se pudieron cargar tus permisos. Revisa tu señal y{' '}
          <Text onPress={pedirTextos} style={{ fontWeight: '700', textDecorationLine: 'underline' }}>vuelve a intentar</Text>.
        </Aviso>
      ) : null}
      {error ? <Aviso>{error}</Aviso> : null}
      <BotonSistema etiqueta={enviando ? 'Enviando…' : 'Unirme'} alTocar={enviar} deshabilitado={!listo || enviando} color={t.color.magenta} />
    </Formulario>
  );
}
