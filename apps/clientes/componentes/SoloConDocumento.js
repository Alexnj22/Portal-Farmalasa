// Lo que ve quien entró con el CÓDIGO del ticket al tocar algo que pide DUI y
// teléfono (2026-10-19, decisión del dueño). El código viene impreso en cada
// ticket: con él se ven los puntos, el saldo, la tarjeta, el nivel y las
// ofertas; las compras, facturas, reservas, el chat y lo demás piden los dos
// datos de la ficha. Quien lo decide es el servidor (lista blanca en
// app-clientes); esta pantalla sólo lo dice y lleva a completar la entrada
// SIN cerrar la sesión de código: si se arrepiente, sigue donde estaba.
import { router } from 'expo-router';
import { BotonSistema, colorSistema, Formulario } from './sistema';
import { Aviso, Texto } from './ui';
import { MENSAJE_CODIGO, useSesion } from '../lib/sesion';
import { useTema } from '../tema/tema';

export function irACompletarEntrada() {
  useSesion.getState().completar();
  router.push({ pathname: '/entrar', params: { completar: '1' } });
}

export default function SoloConDocumento() {
  const t = useTema();
  return (
    <Formulario>
      <Aviso tipo="aviso">{MENSAJE_CODIGO}</Aviso>
      <Texto nivel={2} estilo={{ marginHorizontal: 32, color: colorSistema.texto2, fontSize: 15 }}>
        Con el código de tu ticket ves tus puntos, tu saldo, tu tarjeta y las ofertas. Tus compras, facturas,
        reservas y el chat con la farmacia piden tu DUI y teléfono, para que nadie más los vea con sólo ver tu ticket.
      </Texto>
      <BotonSistema etiqueta="Entrar con DUI y teléfono" alTocar={irACompletarEntrada} color={t.color.magenta} />
    </Formulario>
  );
}
