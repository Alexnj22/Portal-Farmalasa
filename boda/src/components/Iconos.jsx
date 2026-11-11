// Íconos de línea propios (24×24, trazo 1.8): uno por destino de la app.
const P = {
  inicio: 'M3.5 10.5 12 4l8.5 6.5V20a1 1 0 0 1-1 1h-5v-6h-5v6h-5a1 1 0 0 1-1-1z',
  lugar: 'M12 21s-7-6.2-7-11.5a7 7 0 0 1 14 0C19 14.8 12 21 12 21zM12 12.2a2.6 2.6 0 1 0 0-5.2 2.6 2.6 0 0 0 0 5.2z',
  confirmar: 'M4 12.5l5 5L20 6.5',
  mensajes: 'M4 5.5h16v10.5H9l-5 4z',
  mas: 'M5 12h.01M12 12h.01M19 12h.01',
  hoy: 'M12 7v5l3 2M12 21a9 9 0 1 0 0-18 9 9 0 0 0 0 18z',
  camara: 'M4 8h3l2-2.5h6L17 8h3v11H4zM12 16.5a3.5 3.5 0 1 0 0-7 3.5 3.5 0 0 0 0 7z',
  musica: 'M9 18V6l11-2v12M9 18a3 3 0 1 1-6 0 3 3 0 0 1 6 0zM20 16a3 3 0 1 1-6 0 3 3 0 0 1 6 0z',
  juego: 'M7 9v4M5 11h4M15.5 10h.01M18 12.5h.01M8 5h8a5 5 0 0 1 5 5v3a4 4 0 0 1-7 2.6L13 14h-2l-1 1.6A4 4 0 0 1 3 13v-3a5 5 0 0 1 5-5z',
  fotos: 'M4 5h16v14H4zM4 15l4.5-4.5 4 4 2.5-2.5L20 17M15.5 9.5h.01',
  mesa: 'M12 9a3 3 0 1 0 0-6 3 3 0 0 0 0 6zM4 21v-1a5 5 0 0 1 5-5h6a5 5 0 0 1 5 5v1',
  tel: 'M5 4h3.5l1.5 4.5-2 1.5a11 11 0 0 0 6 6l1.5-2L20 15.5V19a1 1 0 0 1-1 1A16 16 0 0 1 4 5a1 1 0 0 1 1-1z',
  altavoz: 'M4 9.5h3.5L12 5v14l-4.5-4.5H4zM15.5 9a4 4 0 0 1 0 6M18 6.5a7.5 7.5 0 0 1 0 11',
  atras: 'M15 5l-7 7 7 7',
  flecha: 'M9 5l7 7-7 7',
  letra: 'M3 19l5-13 5 13M4.8 14.5h6.4M15 19l3-8 3 8M15.9 16.6h4.2',
  calendario: 'M4 6h16v14H4zM4 10h16M8 3.5v4M16 3.5v4',
  whatsapp: 'M4 20l1.3-4A8 8 0 1 1 8 19zM9 9.5c0 3 2.5 5.5 5.5 5.5l1-1.5-2-1-1 1a4 4 0 0 1-2-2l1-1-1-2z',
  regalo: 'M4 10h16v3H4zM5 13h14v7H5zM12 10v10M12 10c-1.5-3-5-3.5-5-1.2C7 10 12 10 12 10zm0 0c1.5-3 5-3.5 5-1.2 0 1.2-5 1.2-5 1.2z',
  estrella: 'M12 3.5l2.6 5.3 5.9.9-4.3 4.1 1 5.8L12 16.8 6.8 19.6l1-5.8L3.5 9.7l5.9-.9z',
  play: 'M8 5.5v13l10.5-6.5z',
  pausa: 'M8 5v14M16 5v14',
  buscar: 'M11 18a7 7 0 1 0 0-14 7 7 0 0 0 0 14zM20 20l-4-4',
};
export default function Icono({ n, tam = 24, grueso = 1.8, ...resto }) {
  return (
    <svg width={tam} height={tam} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={n === 'mas' ? 3.2 : grueso}
      strokeLinecap="round" strokeLinejoin="round" aria-hidden focusable="false" {...resto}>
      <path d={P[n]} />
    </svg>
  );
}
