// Unirse desde la app. No crea la ficha: deja un pre-registro que se completa
// en la primera compra en sala (ver el encabezado de `app-clientes`). Mientras
// tanto, la persona ya entra y ve las ofertas.
import { useEffect, useState } from 'react';
import * as Device from 'expo-device';
import { Aviso, Boton, Campo, Casilla, Pantalla, Tarjeta, Texto, Titulo } from '../componentes/ui';
import { llamar } from '../lib/api';
import { plataforma, useSesion } from '../lib/sesion';

export default function Registro() {
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

  async function enviar() {
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

  const listo = f.nombre.trim().length >= 3 && f.documento.length >= 7 && f.telefono.replace(/\D/g, '').length >= 8 && programa && textos;

  return (
    <Pantalla conPestanas={false}>
      <Texto nivel={2}>
        Deja tus datos y en tu próxima compra en sala te pedimos tu DUI para completar tu ficha. Desde ese momento
        empiezas a acumular.
      </Texto>
      <Campo etiqueta="Nombre completo" value={f.nombre} onChangeText={cambiar('nombre')} autoCapitalize="words" textContentType="name" />
      <Campo etiqueta="DUI o documento" placeholder="00000000-0" value={f.documento} onChangeText={cambiar('documento')} autoCapitalize="characters" autoCorrect={false} />
      <Campo etiqueta="Teléfono" placeholder="7000 0000" value={f.telefono} onChangeText={cambiar('telefono')} keyboardType="phone-pad" textContentType="telephoneNumber" />
      <Campo etiqueta="Correo (opcional)" value={f.email} onChangeText={cambiar('email')} keyboardType="email-address" autoCapitalize="none" textContentType="emailAddress" />
      <Campo etiqueta="Fecha de nacimiento (opcional)" placeholder="DD/MM/AAAA" value={f.fecha_nacimiento} onChangeText={cambiar('fecha_nacimiento')} keyboardType="numbers-and-punctuation" ayuda="Para tu regalo de cumpleaños." />
      <Tarjeta>
        <Titulo>Tus permisos</Titulo>
        <Casilla marcada={programa} alCambiar={setPrograma}>{textos?.programa ?? '…'}</Casilla>
        <Casilla marcada={promos} alCambiar={setPromos}>{textos?.promociones ?? '…'} (Opcional)</Casilla>
      </Tarjeta>
      {error ? <Aviso>{error}</Aviso> : null}
      <Boton alTocar={enviar} cargando={enviando} deshabilitado={!listo}>Unirme</Boton>
    </Pantalla>
  );
}
