// La hora de un texto que lee una persona, en 12 horas SIEMPRE (usuario,
// 23-sep y 24-sep). Gemela de `hora12` en src/utils/hora.js y de
// `public.hora_12(time)`: las tres tienen que decir lo mismo.
//
// «13:06» / «13:06:00» → «1:06 p. m.», con espacios que no se cortan. Un texto
// que no es una hora vuelve tal cual: un mensaje con la hora cruda es mejor que
// una función que lanza en medio de un aviso.
export const hora12 = (hhmm: string | null | undefined): string => {
  const m = /^(\d{1,2}):(\d{2})/.exec(String(hhmm ?? ''));
  if (!m) return String(hhmm ?? '');
  const h = Number(m[1]);
  const nb = ' ';
  return `${h % 12 || 12}:${m[2]}${nb}${h < 12 ? `a.${nb}m.` : `p.${nb}m.`}`;
};
