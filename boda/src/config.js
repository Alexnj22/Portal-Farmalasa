// ─────────────────────────────────────────────────────────────────────────────
// TODO el contenido del sitio vive acá. Cambiar nombres, fechas, lugares, fotos
// y textos en este archivo; los componentes no tienen texto de la boda escrito.
// Los valores de abajo son de EJEMPLO.
// ─────────────────────────────────────────────────────────────────────────────

export const boda = {
  // Dirección pública del sitio (sin / al final). La usa la vista previa de
  // WhatsApp/Facebook, que necesita la URL completa de la foto de portada.
  sitio: 'https://boda.ejemplo.com',

  // Idiomas del sitio para los invitados. Con ['es'] no aparece el botón de
  // idioma. El inglés toma sus textos del bloque `en` (al final del archivo);
  // lo que no esté traducido ahí se muestra en español.
  idiomas: ['es', 'en'],

  novios: {
    el: 'Eduardo',
    ella: 'Alessandra',
    // Cómo se firma en el sitio y en el WhatsApp
    firma: 'Alessandra & Eduardo',
    hashtag: '#AlessandraYEduardo2027',
  },

  // Hora local del lugar. El desfase (-06:00 = El Salvador) evita que el
  // contador cambie según la zona del invitado.
  fecha: '2027-04-17T15:00:00-06:00',
  zonaHoraria: 'America/El_Salvador',

  // Fases del sitio. Con 'auto' se decide por fecha:
  //   antes de `invitacionesDesde`   → save-the-date
  //   hasta el día de la boda         → invitacion
  //   el día de la boda (y el sig.)   → boda (álbum abierto, pantalla en vivo)
  //   después                         → recuerdos
  // Para forzar una: 'save-the-date' | 'invitacion' | 'boda' | 'recuerdos'.
  // (Para previsualizar sin tocar esto: agregar ?fase=boda a la dirección.)
  fase: 'auto',
  invitacionesDesde: '2027-01-15',
  confirmarAntesDe: '2027-03-15',

  frase: 'Con la bendición de Dios y de nuestros padres, queremos compartir con ustedes el día más feliz de nuestras vidas.',

  // Fotos: ponerlas en /public/fotos/ y referirlas como '/fotos/archivo.jpg'.
  // Las de ejemplo vienen de Unsplash (libres de uso).
  portada: 'https://images.unsplash.com/photo-1519741497674-611481863552?w=1800&q=80',
  // Foto para la vista previa del enlace en WhatsApp (opcional; si no, la portada).
  // Ideal: horizontal, 1200×630, menos de 300 KB.
  portadaCompartir: 'https://images.unsplash.com/photo-1519741497674-611481863552?w=1200&h=630&fit=crop&q=75',
  galeria: [
    'https://images.unsplash.com/photo-1522673607200-164d1b6ce486?w=1200&q=80',
    'https://images.unsplash.com/photo-1511285560929-80b456fea0bc?w=1200&q=80',
    'https://images.unsplash.com/photo-1465495976277-4387d4b0b4c6?w=1200&q=80',
    'https://images.unsplash.com/photo-1529636798458-92182e662485?w=1200&q=80',
    'https://images.unsplash.com/photo-1606216794074-735e91aa2c92?w=1200&q=80',
    'https://images.unsplash.com/photo-1583939003579-730e3918a45a?w=1200&q=80',
  ],

  historia: [
    { fecha: '2018', titulo: 'Nos conocimos', texto: 'Un amigo en común, una fiesta y una conversación que no terminó.' },
    { fecha: '2019', titulo: 'Primera cita', texto: 'Pupusas, lluvia y la certeza de que había algo especial.' },
    { fecha: '2023', titulo: 'Nuestro primer viaje', texto: 'Descubrimos que también somos buenos compañeros de aventura.' },
    { fecha: '2026', titulo: '¡Dijo que sí!', texto: 'Frente al mar, con el corazón a mil.' },
  ],

  // Lugares: lat/lng se sacan de Google Maps (clic derecho → copiar coordenadas).
  lugares: [
    {
      id: 'ceremonia',
      tipo: 'Ceremonia religiosa',
      nombre: 'Iglesia (por definir)',
      direccion: 'Dirección de la iglesia, San Salvador',
      hora: '3:00 p. m.',
      lat: 13.6929,
      lng: -89.2182,
    },
    {
      id: 'recepcion',
      tipo: 'Recepción',
      nombre: 'Salón de eventos (por definir)',
      direccion: 'Dirección del salón, Antiguo Cuscatlán',
      hora: '5:30 p. m.',
      lat: 13.6764,
      lng: -89.2516,
    },
  ],

  itinerario: [
    { hora: '3:00 p. m.', titulo: 'Ceremonia', icono: '⛪' },
    { hora: '4:30 p. m.', titulo: 'Sesión de fotos', icono: '📸' },
    { hora: '5:30 p. m.', titulo: 'Cóctel de bienvenida', icono: '🥂' },
    { hora: '7:00 p. m.', titulo: 'Entrada de los novios y cena', icono: '🍽️' },
    { hora: '8:30 p. m.', titulo: 'Primer baile', icono: '💃' },
    { hora: '9:00 p. m.', titulo: '¡A bailar!', icono: '🎶' },
    { hora: '1:00 a. m.', titulo: 'Despedida', icono: '✨' },
  ],

  vestimenta: {
    codigo: 'Formal',
    detalle: 'Caballeros: traje oscuro. Damas: vestido largo o de cóctel. Les pedimos reservar el color blanco para la novia.',
    paleta: ['#6b7f5e', '#c9a77c', '#8c6a5d', '#3f4a5a', '#e7d8c9'],
  },

  regalos: {
    texto: 'Su presencia es nuestro mejor regalo. Si desean tener un detalle con nosotros, les compartimos estas opciones:',
    opciones: [
      { titulo: 'Lluvia de sobres', detalle: 'Habrá un buzón el día de la boda.' },
      { titulo: 'Transferencia', detalle: 'Banco Ejemplo · Cuenta de ahorro', copiar: '0000-0000-0000' },
      // { titulo: 'Mesa de regalos', detalle: 'Tienda X', enlace: 'https://...' },
    ],
  },

  hospedaje: [
    { nombre: 'Hotel cercano (ejemplo)', detalle: 'A 5 minutos del salón. Mencionar la boda para tarifa especial.', enlace: '' },
  ],

  preguntas: [
    { p: '¿Puedo llevar acompañante?', r: 'Tu invitación indica cuántos pases tiene. Si tienes dudas, escríbenos.' },
    { p: '¿Habrá niños?', r: 'Amamos a los niños, pero esta será una celebración para adultos (salvo los que aparecen en la invitación).' },
    { p: '¿Hay parqueo?', r: 'Sí, el salón cuenta con parqueo gratuito y vigilado.' },
    { p: '¿Cómo comparto mis fotos?', r: 'El día de la boda verás códigos QR en cada mesa. Escanéalo y sube tus fotos al álbum compartido.' },
  ],

  // Momentos para etiquetar las fotos del álbum
  momentos: ['Ceremonia', 'Cóctel', 'Fiesta', 'Detalles', 'Selfies', 'Retos'],

  contacto: { whatsapp: '50370000000', nombre: 'Eduardo' },

  // Lista de canciones (opcional): enlace a una playlist colaborativa
  playlist: '',

  // Música de la apertura (opcional). Archivo en /public/musica/… o una URL.
  // Empieza apagada: el invitado la enciende con el botón de la nota.
  musica: '',

  // Juegos de la boda. Ya vienen armados: se pueden usar tal cual o cambiar.
  //   · Trivia en vivo: el proyector la corre solo (20 s por pregunta).
  //     `correcta` = posición de la opción buena (0 = la primera). Las de tipo
  //     'quien' no tienen respuesta buena: el salón vota y se ve el resultado.
  //   · Bingo: cada teléfono arma su cartón al azar con estas casillas.
  //   · Retos de fotos: cada reto sube su foto al álbum.
  juego: {
    titulo: '¿Cuánto conoces a los novios?',
    segundos: 20,
    preguntas: [
      { p: '¿Dónde se conocieron?', opciones: ['En la universidad', 'En una fiesta', 'En el trabajo', 'Por una app'], correcta: 1 },
      { p: '¿Quién es más probable que llegue tarde?', opciones: ['Alessandra', 'Eduardo'], tipo: 'quien' },
      { p: '¿Cuál fue su primera cita?', opciones: ['Cine', 'Pupusas', 'Playa', 'Café'], correcta: 1 },
      { p: '¿Quién dijo «te quiero» primero?', opciones: ['Alessandra', 'Eduardo'], correcta: 1 },
      { p: '¿Quién llora con las películas?', opciones: ['Alessandra', 'Eduardo'], tipo: 'quien' },
      { p: '¿Cuántos años llevan juntos?', opciones: ['3', '5', '7', '9'], correcta: 2 },
      { p: '¿Quién cocina mejor?', opciones: ['Alessandra', 'Eduardo', 'Ninguno', 'Los dos'], correcta: 0 },
      { p: '¿Quién se duerme primero en una fiesta?', opciones: ['Alessandra', 'Eduardo'], tipo: 'quien' },
      { p: '¿Dónde fue la pedida de mano?', opciones: ['En la montaña', 'En un restaurante', 'Frente al mar', 'En casa'], correcta: 2 },
      { p: '¿A dónde se van de luna de miel?', opciones: ['Europa', 'Cancún', 'Japón', 'Es sorpresa'], correcta: 3 },
    ],
    bingo: [
      'Alguien llora en la ceremonia', 'El novio se equivoca en los votos', 'Un niño baila solo', 'Alguien dice «¡que se besen!»',
      'Suena una de Marc Anthony', 'La abuela saca los pasos', 'Alguien pierde un zapato', 'Brindis que hace llorar',
      'Foto con los ojos cerrados', 'Alguien pide «la última»', 'Se cae una copa', 'Trencito en la pista',
      'Un tío cuenta un chiste', 'Alguien canta a todo pulmón', 'Los novios bailan pegados', 'Alguien llega tarde',
      'Se acaban las servilletas', 'Selfie con los novios', 'Alguien se duerme', 'Lanzan el ramo',
      'Alguien baila con los zapatos en la mano', 'Suena una cumbia', 'Un brindis con chiste', 'Alguien graba un video vertical',
    ],
    retos: [
      'Una selfie con alguien que acabas de conocer', 'Tu mesa entera haciendo una cara chistosa', 'Los zapatos más elegantes de la fiesta',
      'Alguien bailando como si nadie lo viera', 'Un brindis con los novios', 'La foto más romántica de una pareja invitada',
      'El detalle de la decoración que más te gustó', 'Tu mejor paso de baile', 'Una foto con el invitado de más edad',
      'Los novios sin que se den cuenta',
    ],
  },

  // ── Inglés ────────────────────────────────────────────────────────────────
  // Misma forma que arriba y en el MISMO orden (se cruza por posición). Sólo
  // los textos: fechas, horas, coordenadas y enlaces salen de la versión en
  // español. Lo que falte acá se muestra en español.
  en: {
    frase: 'With the blessing of God and our parents, we want to share with you the happiest day of our lives.',
    historia: [
      { titulo: 'We met', texto: 'A mutual friend, a party and a conversation that never ended.' },
      { titulo: 'First date', texto: 'Pupusas, rain and the certainty that this was something special.' },
      { titulo: 'Our first trip', texto: 'We found out we are great travel partners too.' },
      { titulo: 'She said yes!', texto: 'By the sea, with our hearts racing.' },
    ],
    lugares: [{ tipo: 'Religious ceremony' }, { tipo: 'Reception' }],
    itinerario: [
      { titulo: 'Ceremony' }, { titulo: 'Photo session' }, { titulo: 'Welcome cocktail' },
      { titulo: 'Grand entrance and dinner' }, { titulo: 'First dance' }, { titulo: "Let's dance!" }, { titulo: 'Farewell' },
    ],
    vestimenta: {
      codigo: 'Formal',
      detalle: 'Gentlemen: dark suit. Ladies: long or cocktail dress. Please leave white for the bride.',
    },
    regalos: {
      texto: 'Your presence is our greatest gift. If you wish to give us something, here are some options:',
      opciones: [
        { titulo: 'Envelope box', detalle: 'There will be a box at the reception.' },
        { titulo: 'Bank transfer', detalle: 'Banco Ejemplo · Savings account' },
      ],
    },
    hospedaje: [{ detalle: '5 minutes from the venue. Mention the wedding for a special rate.' }],
    preguntas: [
      { p: 'Can I bring a plus-one?', r: 'Your invitation shows how many seats it includes. If in doubt, message us.' },
      { p: 'Are children invited?', r: 'We love kids, but this will be an adults-only celebration (except those named on the invitation).' },
      { p: 'Is there parking?', r: 'Yes, the venue has free, guarded parking.' },
      { p: 'How do I share my photos?', r: 'On the wedding day you will find QR codes on each table. Scan it and upload your photos to the shared album.' },
    ],
    momentos: ['Ceremony', 'Cocktail', 'Party', 'Details', 'Selfies', 'Challenges'],
  },
};

export const fechaBoda = new Date(boda.fecha);
