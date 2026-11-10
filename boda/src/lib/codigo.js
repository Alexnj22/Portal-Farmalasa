// Sin 0/O ni 1/I/L: el código se dicta por teléfono sin confusiones.
const ALFABETO = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';

export function nuevoCodigo(largo = 6) {
  const bytes = crypto.getRandomValues(new Uint8Array(largo));
  return Array.from(bytes, (b) => ALFABETO[b % ALFABETO.length]).join('');
}

export const enlaceInvitacion = (codigo) => `${window.location.origin}/i/${codigo}`;
