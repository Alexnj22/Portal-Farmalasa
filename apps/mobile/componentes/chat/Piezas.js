// Piezas del chat con clientes, NATIVAS — las del portal (`ClienteAvatar`,
// `ChipsDeEstado`, las etiquetas de tipo y nivel). Qué dice cada una sale del
// núcleo (`utils/chatClientes`).
import { memo } from 'react';
import { Image, Text, View } from 'react-native';
import { ESTADOS, NIVELES, esperaDe, estadoDeConversacion, inicialesDeCliente, tipoDeCliente } from '@nucleo/utils/chatClientes';
import { shortEmployeeName } from '@nucleo/utils/nameUtils';
import { Pildora } from '../avisos/Piezas';
import { MARCA } from '../inicio/marca';

// Las variantes del portal, en los colores de la app.
export const COLOR = {
  info: MARCA.azulClaro, success: MARCA.verde, warning: MARCA.ambar, danger: MARCA.rojo, neutral: '#8E8E93',
  'chart-1': MARCA.azul, 'chart-4': '#B7791F', 'chart-6': '#6929C4', 'chart-9': '#981D97',
};
export const colorDe = (variant) => COLOR[variant] ?? COLOR.neutral;

/** La foto de perfil del cliente (opcional, la sube desde su app) o sus iniciales. */
export const ClienteAvatar = memo(function ClienteAvatar({ cliente, fotoUrl, tamano = 40 }) {
  if (fotoUrl) return <Image source={{ uri: fotoUrl }} style={{ width: tamano, height: tamano, borderRadius: tamano / 2 }} accessibilityIgnoresInvertColors />;
  return (
    <View style={{ width: tamano, height: tamano, borderRadius: tamano / 2, alignItems: 'center', justifyContent: 'center', backgroundColor: 'rgba(0,82,204,0.14)' }}>
      <Text style={{ color: MARCA.azulClaro, fontSize: tamano * 0.36, fontWeight: '900' }}>{inicialesDeCliente(cliente)}</Text>
    </View>
  );
});

/** «Nuevo», «En atención · Ana», «Esperando al cliente», «Resuelta», y cuánto lleva esperando un «Nuevo». */
export function ChipsDeEstado({ conversacion: c, atiende, ahora }) {
  const clave = estadoDeConversacion(c);
  const estado = ESTADOS[clave];
  const quien = clave === 'atencion' && atiende ? shortEmployeeName(atiende) : '';
  const espera = esperaDe(c, ahora);
  return (
    <>
      <Pildora texto={`${estado.label}${quien ? ` · ${quien}` : ''}`} color={colorDe(estado.variant)} />
      {espera ? <Pildora texto={`⏱ ${espera.label}`} color={colorDe(espera.tono)} /> : null}
    </>
  );
}

/** «Team», «Mayoreo <rango>» o «Cliente», y su nivel del programa de puntos. */
export function EtiquetasDeCliente({ c }) {
  const tipo = tipoDeCliente(c);
  const nivel = NIVELES[c?.nivel];
  return (
    <>
      <Pildora texto={tipo.label} color={colorDe(tipo.variant)} />
      {nivel ? <Pildora texto={nivel.label} color={colorDe(nivel.variant)} /> : null}
    </>
  );
}
