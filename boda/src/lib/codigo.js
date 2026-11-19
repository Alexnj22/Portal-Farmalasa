// Sin 0/O ni 1/I/L: el código se dicta por teléfono sin confusiones. Es el
// mismo alfabeto que codigo_aleatorio() en la base.
const ALFABETO = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';

// 8 caracteres (31^8 ≈ 850 mil millones). Los códigos de 6 ya repartidos siguen valiendo.
export function nuevoCodigo(largo = 8) {
  const bytes = crypto.getRandomValues(new Uint8Array(largo));
  return Array.from(bytes, (b) => ALFABETO[b % ALFABETO.length]).join('');
}

export const enlaceInvitacion = (codigo) => `${window.location.origin}/i/${codigo}`;
