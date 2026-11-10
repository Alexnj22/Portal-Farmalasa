import { boda, fechaBoda } from '../config';

const tz = boda.zonaHoraria;

export const fechaLarga = (d = fechaBoda) =>
  d.toLocaleDateString('es', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric', timeZone: tz });

export const fechaCorta = (d = fechaBoda) =>
  d.toLocaleDateString('es', { day: '2-digit', month: '2-digit', year: 'numeric', timeZone: tz }).replaceAll('/', ' · ');

export const fechaHora = (iso) =>
  new Date(iso).toLocaleString('es', { day: 'numeric', month: 'short', hour: 'numeric', minute: '2-digit' });

export const limiteConfirmar = () =>
  new Date(`${boda.confirmarAntesDe}T12:00:00`).toLocaleDateString('es', { day: 'numeric', month: 'long' });

function ics(d) {
  return d.toISOString().replace(/[-:]/g, '').replace(/\.\d{3}/, '');
}

/** Archivo .ics para "Agregar al calendario" (Apple, Outlook, etc.). */
export function descargarIcs() {
  const fin = new Date(fechaBoda.getTime() + 10 * 3600e3);
  const lugar = boda.lugares[0];
  const texto = [
    'BEGIN:VCALENDAR', 'VERSION:2.0', 'PRODID:-//boda//ES', 'BEGIN:VEVENT',
    `UID:${ics(fechaBoda)}@boda`, `DTSTAMP:${ics(new Date())}`,
    `DTSTART:${ics(fechaBoda)}`, `DTEND:${ics(fin)}`,
    `SUMMARY:Boda de ${boda.novios.firma}`,
    `LOCATION:${lugar ? `${lugar.nombre}, ${lugar.direccion}` : ''}`,
    `DESCRIPTION:${window.location.origin}`,
    'BEGIN:VALARM', 'TRIGGER:-P7D', 'ACTION:DISPLAY', 'DESCRIPTION:¡Falta una semana!', 'END:VALARM',
    'END:VEVENT', 'END:VCALENDAR',
  ].join('\r\n');
  const a = document.createElement('a');
  a.href = URL.createObjectURL(new Blob([texto], { type: 'text/calendar' }));
  a.download = 'boda.ics';
  a.click();
}

export function enlaceGoogleCalendar() {
  const fin = new Date(fechaBoda.getTime() + 10 * 3600e3);
  const lugar = boda.lugares[0];
  const p = new URLSearchParams({
    action: 'TEMPLATE',
    text: `Boda de ${boda.novios.firma}`,
    dates: `${ics(fechaBoda)}/${ics(fin)}`,
    details: window.location.origin,
    location: lugar ? `${lugar.nombre}, ${lugar.direccion}` : '',
  });
  return `https://calendar.google.com/calendar/render?${p}`;
}
