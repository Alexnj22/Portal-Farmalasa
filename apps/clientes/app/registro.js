// Unirse desde la app. No crea la ficha: deja un pre-registro que se completa
// en la primera compra en sala (ver el encabezado de `app-clientes`). Mientras
// tanto, la persona ya entra y ve las ofertas.
//
// Forma del sistema: formulario agrupado y los permisos como interruptores
// (iOS no tiene casillas de verificación).
import { useEffect, useState } from 'react';
import * as Device from 'expo-device';
import { BotonSistema, FilaCampo, FilaInterruptor, Formulario, Grupo } from '../componentes/sistema';
import { Aviso } from '../componentes/ui';
import { llamar } from '../lib/api';
import { plataforma, useSesion } from '../lib/sesion';
import { useTema } from '../tema/tema';

function conGuion(v) {
  const d = v.replace(/\D/g, '').slice(0, 9);
  return d.length > 8 ? `${d.slice(0, 8)}-${d.slice(8)}` : d;
}

export default function Registro() {
  const t = useTema();
  const abrir = useSesion((s) => s.abrir);
  const [f, setF] = useState({ nombre: '', documento: '', telefono: '', email: '', fecha_nacimiento: '' });
  const [programa, setPrograma] = useState(false);
  const [promos, setPromos] = useState(false);
  const [textos, setTextos] = useState(null);
  const [error, setError] = useState(null);
  const [enviando, setEnviando] = useState(false);
  const cambiar = (k) => (v) => setF((x) => ({ ...x, [k]: v }));

  // Los textos de los permisos vienen del servidor: lo que se archiva como
  // prueba es el texto que la persona tuvo delante (Art. 27 c).
  useEffect(() => { llamar('textos').then((r) => r?.ok && setTextos(r.textos)); }, []);

  // DD/MM/AAAA → AAAA-MM-DD; vacío o mal escrito no se manda.
  const nacimiento = (() => {
    const m = f.fecha_nacimiento.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/);
    return m ? `${m[3]}-${m[2].padStart(2, '0')}-${m[1].padStart(2, '0')}` : null;
  })();

  const listo = f.nombre.trim().length >= 3 && f.documento.length >= 7
    && f.telefono.replace(/\D/g, '').length >= 8 && programa && !!textos;

  async function enviar() {
    if (!listo || enviando) return;
    setError(null);
    setEnviando(true);
    const r = await llamar('registrar', {
      ...f, fecha_nacimiento: nacimiento, acepta_programa: programa, acepta_promociones: promos,
      plataforma, dispositivo: Device.modelName ?? null,
    });
    setEnviando(false);
    if (r?.ok && r.token) await abrir(r.token);
    else setError(r?.mensaje ?? 'No se pudo completar el registro.');
  }

  return (
    <Formulario>
      <Grupo titulo="Tus datos" pie="En tu próxima compra en sala te pedimos el DUI para completar tu ficha. Desde esa compra empiezas a acumular.">
        <FilaCampo placeholder="Nombre completo" value={f.nombre} onChangeText={cambiar('nombre')} autoCapitalize="words" textContentType="name" />
        <FilaCampo placeholder="DUI" value={f.documento} autoCapitalize="characters" autoCorrect={false}
          keyboardType="numbers-and-punctuation"
          onChangeText={(v) => cambiar('documento')(/[A-Za-z]/.test(v) ? v.toUpperCase() : conGuion(v))} />
        <FilaCampo placeholder="Teléfono" value={f.telefono} keyboardType="phone-pad" textContentType="telephoneNumber"
          onChangeText={(v) => cambiar('telefono')(v.replace(/[^\d ]/g, '').slice(0, 9))} />
      </Grupo>
      <Grupo titulo="Opcional" pie="La fecha es para tu regalo de cumpleaños.">
        <FilaCampo placeholder="Correo" value={f.email} onChangeText={cambiar('email')} keyboardType="email-address" autoCapitalize="none" textContentType="emailAddress" />
        <FilaCampo placeholder="Nacimiento (DD/MM/AAAA)" value={f.fecha_nacimiento} onChangeText={cambiar('fecha_nacimiento')} keyboardType="numbers-and-punctuation" />
      </Grupo>
      <Grupo titulo="Tus permisos" pie="El programa es necesario para acumular. Las promociones son opcionales y las puedes quitar cuando quieras.">
        <FilaInterruptor titulo="Programa de puntos" detalle={textos?.programa} valor={programa} alCambiar={setPrograma} color={t.color.magenta} />
        <FilaInterruptor titulo="Promociones" detalle={textos?.promociones} valor={promos} alCambiar={setPromos} color={t.color.magenta} />
      </Grupo>
      {error ? <Aviso>{error}</Aviso> : null}
      <BotonSistema etiqueta={enviando ? 'Enviando…' : 'Unirme'} alTocar={enviar} deshabilitado={!listo || enviando} color={t.color.magenta} />
    </Formulario>
  );
}
