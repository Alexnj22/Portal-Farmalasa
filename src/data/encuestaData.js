// Encuesta de Clima Organizacional 2026 — Farmacias La Popular y La Salud
// Datos tabulados de 27 colaboradores

export const RESPUESTAS = [
  { nombre: 'NATHALY',  isJefe: true,  sucursal: 'Salud 1',    r: ['C','B','B','C','B','C','B','B','C','B','C','B','C','C','A','A','A','A','A','B','A','B','B','A','A','A','A','B','A','A','8','B','B','A','B','C','C','B','C','C','B','B'], comentario: 'Considero que el ambiente en la sala no es malo, ya que todos nos llevamos bien, lo único que cambiaría es rotar a que no tengan siempre juntas/os los turnos las mismas personas para que convivamos entre todos y no se pierda la unidad que tenemos' },
  { nombre: 'STEFANY',  isJefe: false, sucursal: 'Salud 1',    r: ['C','B','B','C','B','C','D','C','D','D','C','D','D','D','C','C','B','B','A','A','A','A','A','A','A','A','A','B','A','A','8','B','A','B','A','A','A','A','C','C','A','B'], comentario: 'Mejorar la atención y comunicación entre el equipo de trabajo. Que todos caminemos enfocados hacia el mismo objetivo. Enfocarnos en los problemas del trabajo y no en asuntos personales que interrumpen el desarrollo del día.' },
  { nombre: 'ADRIANA',  isJefe: false, sucursal: 'Salud 1',    r: ['A','B','B','B','B','B','C','C','D','C','C','C','C','C','B','B','B','B','B','B','A','C','B','B','B','B','B','B','B','B','7','B','B','D','B','B','B','B','C','C','B','B'], comentario: 'Definir mejor las responsabilidades de cada uno. Comunicar oportunamente cambios en procesos. Dirigir con formalidad y respeto, dar el ejemplo de compromiso y solventar inconvenientes a la brevedad.' },
  { nombre: 'ALEX',     isJefe: false, sucursal: 'Salud 1',    r: ['D','B','B','D','D','D','C','D','D','C','C','D','B','D','B','B','A','B','A','B','B','C','B','A','A','A','A','C','A','A','8','A','A','B','B','D','C','B','C','C','C', null], comentario: 'Confío en los procesos administrativos que tomarán medidas para que todo mejore. Ya se les hizo saber cómo estamos actualmente.' },
  { nombre: 'RONALDO',  isJefe: false, sucursal: 'Salud 1',    r: ['A','B','B','B','B','A','B','C','C','B','B','B','A','C','B','B','A','C','B','B','A','B','A','B','A','A','B','B','C','B','7','B','B','A','B','B','A','A','B','B','C','B'], comentario: 'Mejorar la comunicación entre compañeros. Mejorar la atención al cliente vía telefónica. Mejorar el apoyo entre compañeros.' },
  { nombre: 'DANIELA',  isJefe: false, sucursal: 'Salud 1',    r: ['B','B','A','C','C','C','D','C','D','C','C','C','C','C','A','B','A','B','B','B','B','B','B','A','A','A','A','A','B','A','8','B','A','C','B','B','B','B','C','B','C','B'], comentario: 'La comunicación, organizarse, la atención a la hora de consultar alguna duda, sobre todo con la jefa que siento que la atención es lo que menos tiene con nosotros al consultarle algo.' },
  { nombre: 'BRISSA',   isJefe: true,  sucursal: 'Salud 2',    r: ['B','C','A','A','A','A','A','B','B','C','C','C','C','B','B','B','C','C','C','C','A','B','A','A','A','A','A','C','C','B','9','B','B','B','A','B','B','A','C','C','C','B'], comentario: 'Que siempre hayan capacitaciones para adquirir mayor conocimiento. Que se desarrollen charlas psicológicas o talleres de apoyo emocional.' },
  { nombre: 'WILLIAM',  isJefe: false, sucursal: 'Salud 2',    r: ['B','C','C','C','B','B','C','B','C','C','C','C','C','C','C','C','C','B','B','B','B','B','C','B','B','B','C','B','B','A','9','B','B','D','B','C','B','B','C','C','B','C'], comentario: null },
  { nombre: 'CRISTIAN', isJefe: false, sucursal: 'Salud 2',    r: ['C','C','B','B','A','B','A','B','B','B','B','B','A','B','B','B','B','C','B','B','B','A','B','B','B','C','A','B','A','B','8','B','B','A','B','B','B','A','B','C','C','C'], comentario: 'Administración debe enfocarse en las actitudes de cada compañero de sucursal, para notificarle en qué mejorar.' },
  { nombre: 'LOLI',     isJefe: true,  sucursal: 'La Popular', r: ['D','A','B','A','A','A','A','A','C','B','C', null,'B','A','B','A','A','A','A','B','A','A','A','A','A','A','A','A','A','A','9','A','A','B','A','A','A','A','D','B','B','B'], comentario: 'Hacer visitas más frecuentes para monitorear el buen funcionamiento. Revisión total de precios y mejores descuentos. Buscar sistema/internet más eficiente para agilizar ventas.' },
  { nombre: 'NATALY',   isJefe: false, sucursal: 'La Popular', r: ['B','A','A','A','A','A','B','B','B','A','B','B','C','B','B','A','A','B','B','A','B','A','B','A','A','A','A','A','A','A','9','A','A','A','B','A','A','A','C','C','B','B'], comentario: null },
  { nombre: 'JENNIFER', isJefe: false, sucursal: 'La Popular', r: ['B','A','B','A','B','C','C','B','B','B','B','D','B','B','B','B','B','B','B','B','A','A','B','A','A','A','A','A','A','A','8', null,'A','B','A','A','A','A','B','B','B','B'], comentario: 'Que el jefe de sala sea accesible, humilde, humanitario/a.' },
  { nombre: 'ANDY',     isJefe: false, sucursal: 'La Popular', r: ['B','A','B','A','B','C','C','A','A','A','B','B','B','B','B','B','B','A','B','B','B','B','B','A','A','A','A','B','B','B','8','B','B','D','B','B','A','B','B','B','B','B'], comentario: 'Evaluación de salarios cada 6 meses o 1 año para quienes tienen más de 1 año de trabajo. Llamadas de atención más privadas y respetuosas. Horarios más accesibles para personas que viven lejos o sin vehículo.' },
  { nombre: 'YAMILETH', isJefe: true,  sucursal: 'Salud 5',    r: ['B','F','A','A','A','A','A','A','B','A','A','A','A','A','A','A','A','B','B','A','A','A','A','A','A','A','A','A','B','A','8','A','A','C','A','A','A','A','B','A','A','C'], comentario: 'Capacitaciones sobre los medicamentos. Visitas frecuentes para hablar con todo el equipo.' },
  { nombre: 'XIOMARA',  isJefe: false, sucursal: 'Salud 5',    r: ['A','F','A','C', null,'C','C','C','C','C','C','C','C','C', null,'A','B','B','B','A','A','A','A','B', null,'C','A','B','C','C','8','B','B', null,'A','A','A','A', null, null, null, null], comentario: 'Mezclar amistad con lo laboral para sacar beneficios. Mejorar la comunicación. Saber expresar y sobrellevar las equivocaciones. Tomar en cuenta el esfuerzo. (Con la dirección administrativa está todo bien y agradezco el apoyo).' },
  { nombre: 'MARILYN',  isJefe: false, sucursal: 'Salud 5',    r: ['B','F','B','C','C','C','C','C','C','C','D','D','D','D','C','A','C','C','D','A','A','C','A','A','A','A','A','B','C','B','8','B','B','D','A','A','A','A','C','B','B','C'], comentario: 'Mejorar el liderazgo, escucha asertiva, evitar chismes. Controlar emociones para que el equipo no tenga miedo de preguntar dudas. Buscar soluciones para cortos de vencimiento. Mejorar ventas frente a la competencia de Salud 5. Comunicar temas de exámenes con anticipación.' },
  { nombre: 'SARAI',    isJefe: false, sucursal: 'Salud 5',    r: ['A','F','B','A','B','A','A','A','B','A','A','A','A','A','B','A','A','A','A','A','A','A','A','A','A','A','A','A','C','B','6','B','A','A','A','A','A','A','A','A','A','C'], comentario: 'Mejorar un poco más la comunicación entre compañeros. La administración hace todo lo posible para que el ambiente entre sucursales esté mejor.' },
  { nombre: 'ELI',      isJefe: true,  sucursal: 'Salud 4',    r: ['D','E','B','B','C','A','B','A','B','C','C','B','B','A','B','B','B','A','C','C','D','B','B','A','B','A','A','B','C','A','8','B','B','B','B','B','A','A','C','B','A','A'], comentario: 'Trabajar más la empatía de cada uno, sobre todo en el personal de atención al cliente, y en mí primero para empezar el cambio. El respeto, la sinceridad y la comunicación.' },
  { nombre: 'IDALIA',   isJefe: false, sucursal: 'Salud 4',    r: ['D','E','B','B','B','C','B','B','B','B','B','B','C','A','B','B','B','B','B','B','C','C','B','A','A','A','A','B','A','A','8','A','B','A','B','B','A','B','B','C','C','B'], comentario: 'Tratar con equidad y respeto. Más enfoque en ventas que en tecnología. Mejorar los movimientos de productos con corto vencimiento ya que el cliente no puede esperar.' },
  { nombre: 'JONATHAN', isJefe: false, sucursal: 'Salud 4',    r: ['C','E','B','A','B','A','B','B','A','B','C','C','B','C','B','B','C','C','C','D','D','D','D','A','A','C','A','A','B','A','9','A','A','A','C','C','C','C','C','C','C','C'], comentario: 'Las metas suben y el esfuerzo también, pero el salario no refleja ese esfuerzo. Los bonos se mantienen aunque las metas crezcan. Hay meses que no se alcanzan los $1,300 y otros que sí se superan los $2,000, pero el bono es el mismo.' },
  { nombre: 'KEVIN',    isJefe: false, sucursal: 'Salud 4',    r: ['B','E','B','B','A','A','A','B','B','B','B','C','C','A','A','B','B','B','B','B','B','A','B','A','A','A','A','B','C','B','8','B','B','A','B','B','B','B','B','B','B','B'], comentario: 'Ser más respetuoso con las ventas del compañero. Brindar ayuda sin esperar nada a cambio. Mejorar el área de consulta de productos, al menos 2 personas para resolver más rápido al cliente.' },
  { nombre: 'CENDY',    isJefe: true,  sucursal: 'Bodega',     r: ['D','G','B','B','B','B','B','B','B','B','B','B','C','B','B','B','B','B','A','B','B','B','B','A','A','A','A','B','B','B','8','A','B','B','A','A','B','B','C','B','B','C'], comentario: 'Hablar con cada uno y resolver de manera imparcial los problemas entre compañeros por malos entendidos.' },
  { nombre: 'FERNANDO', isJefe: false, sucursal: 'Bodega',     r: ['C','G','B','A','A','A','A','A','A','A','A','A','A','A','A','A','A','A','A','A','A','A','A','A','A','A','A','A','A','A','9','A','A','A','A','A','A','A','A','A','A','A'], comentario: 'Todo excelente' },
  { nombre: 'JOSUE',    isJefe: false, sucursal: 'Bodega',     r: ['B','G','B','A','A','A','A','A','A','A','A','A','A','A','A','A','A','A','A','A','A','A','B','A','A','A','A','B','A','A','9','A','A','A','B','B','B','A','C','A','C','B'], comentario: 'Comunicación. La solidaridad. El compañerismo y el trabajo en equipo.' },
  { nombre: 'RODRIGO',  isJefe: true,  sucursal: 'Salud 3',    r: ['C','D','A','B','A','C','A','B','B','B','B','B','B','A','B','B','A','B','A','B','B','B','A','A','B','A','A','B','C','B','8','A','B','C','A','A','B','B','B','B','C','B'], comentario: 'Comentar si la empresa está en buen momento o no, y hacer convivios entre grupos.' },
  { nombre: 'GABY',     isJefe: false, sucursal: 'Salud 3',    r: ['A','D','A','A','B','A','A','A','B','C','A','A','A','A','A','A','A','B','A','A','A','A','A','A','A','A','A','A','C','B','8','B','A','A','A','A','A','A','B','B','B','B'], comentario: 'En muchas ocasiones hay riñas entre compañeros por las ventas. Lo importante es que la empresa crezca como conjunto, no competir individualmente por código de vendedor.' },
  { nombre: 'MARIBEL',  isJefe: false, sucursal: 'Salud 3',    r: ['C','D','B','B','C','A','A','B','C','C','C','B','D','C','A','B','B','B','B','B','B','B','B','A','A','A','A','B','A','B','7','A','C','A','B','B','A','A','C','B','A','B'], comentario: 'La unión y el trabajo en equipo. Informar de todo lo necesario porque a veces hay cosas pendientes que no se hacen. No solo informarle al jefe, sino comunicar entre todos.' },
];

export const BLOQUES = [
  { id: 2, nombre: 'Liderazgo Directo',         color: 'blue',    desc: 'Evaluación del jefe inmediato',          indices: [3,4,5,6,7,8,9,10,11,12,13] },
  { id: 3, nombre: 'Cultura y Ambiente',         color: 'emerald', desc: 'Entorno laboral y relaciones',           indices: [14,15,16,17,18] },
  { id: 4, nombre: 'Compensación y Desarrollo',  color: 'amber',   desc: 'Salario, justicia y crecimiento',        indices: [19,20,21,22] },
  { id: 5, nombre: 'Compromiso e Identidad',     color: 'indigo',  desc: 'Engagement y orgullo laboral',           indices: [23,24,25,26,27] },
  { id: 6, nombre: 'Autovaloración',             color: 'purple',  desc: 'Percepción propia y relaciones',         indices: [28,29,31,32] }, // 30=numeric excluido del puntaje ABCD
  { id: 7, nombre: 'Alta Dirección',             color: 'teal',    desc: 'Confianza en la dirección',              indices: [34,35,36,37] },
  { id: 8, nombre: 'Situación Financiera',       color: 'rose',    desc: 'Percepción de seguridad laboral',        indices: [38,39,40,41] },
];

// Jefe de sala por sucursal (quien es evaluado por los colaboradores en Bloque 2)
export const JEFE_POR_SUCURSAL = {
  'La Popular': 'LOLI',
  'Salud 1':    'NATHALY',
  'Salud 2':    'BRISSA',
  'Salud 3':    'RODRIGO',
  'Salud 4':    'ELI',
  'Salud 5':    'YAMILETH',
  'Bodega':     'CENDY',
};

// Supervisor inmediato de cada jefe de sala (quien evalúan los jefes en Bloque 2)
export const SUPERVISOR_DE_JEFE = {
  'La Popular': 'Supervisor/a de Ventas',
  'Salud 1':    'Supervisor/a de Ventas',
  'Salud 2':    'Supervisor/a de Ventas',
  'Salud 3':    'Supervisor/a de Ventas',
  'Salud 4':    'Supervisor/a de Ventas',
  'Salud 5':    'Supervisor/a de Ventas',
  'Bodega':     'Administración / Jefe de Logística',
};

// Contexto de cada bloque: a quién va dirigida la retroalimentación
export const BLOQUE_CONTEXTO = {
  2: {
    dirigido: 'Jefe inmediato',
    tipo: 'liderazgo',
    badge: 'bg-blue-100 text-blue-700',
    nota: 'Los colaboradores evalúan a su Jefe/a de Sala. Los propios jefes evalúan a su Supervisor/a (o Administración en Bodega). Las puntuaciones bajas aquí requieren acción a nivel de liderazgo local.',
  },
  3: {
    dirigido: 'Jefe + Empresa',
    tipo: 'mixto',
    badge: 'bg-violet-100 text-violet-700',
    nota: 'El ambiente psicológico, físico y el sentido de equipo dependen tanto de la gestión del Jefe de Sala como de las condiciones que provee la empresa. Las áreas bajas requieren intervención en ambos niveles.',
  },
  4: {
    dirigido: 'Empresa / Admin',
    tipo: 'empresa',
    badge: 'bg-amber-100 text-amber-700',
    nota: 'Salario, bonos, equidad y oportunidades de crecimiento son decisiones de Administración y Gerencia. Un puntaje bajo aquí es una señal directa hacia la empresa, no hacia los jefes de sala.',
  },
  5: {
    dirigido: 'Personal + Empresa',
    tipo: 'mixto',
    badge: 'bg-indigo-100 text-indigo-700',
    nota: 'El compromiso y orgullo laboral refleja tanto la motivación personal del colaborador como la calidad del ambiente que crea la empresa. Alto compromiso con bajo salario es una señal de alerta de retención.',
  },
  6: {
    dirigido: 'Personal',
    tipo: 'personal',
    badge: 'bg-purple-100 text-purple-700',
    nota: 'Autoevaluación del propio colaborador. Mide actitud, proactividad, relaciones interpersonales y cómo maneja sus inconformidades. Útil para identificar patrones de comunicación o actitud por sucursal.',
  },
  7: {
    dirigido: 'Alta Dirección',
    tipo: 'empresa',
    badge: 'bg-teal-100 text-teal-700',
    nota: 'Mide la confianza en las decisiones de Gerencia y la transparencia de la dirección. Un score bajo aquí indica desconexión entre la dirección y el equipo operativo.',
  },
  8: {
    dirigido: 'Empresa / Gerencia',
    tipo: 'empresa',
    badge: 'bg-rose-100 text-rose-700',
    nota: 'Percepción de estabilidad financiera y seguridad laboral. La pregunta de recorte de personal (P42) es inversa: acuerdo = preocupación. Un score bajo refleja incertidumbre generalizada.',
  },
};

export const PREGUNTAS = [
  // BLOQUE 1 – Generalidades (no puntuadas)
  { id: 1,  bloque: 1, idx: 0,  texto: '¿Cuánto tiempo tiene de laborar?',                                       opciones: ['< 1 año','1–3 años','3–5 años','> 5 años'],                                         tipo: 'categorica' },
  { id: 2,  bloque: 1, idx: 1,  texto: 'Sucursal o área',                                                         opciones: ['La Popular','Salud 1','Salud 2','Salud 3','Salud 4','Salud 5','Bodega'],              tipo: 'sucursal' },
  { id: 3,  bloque: 1, idx: 2,  texto: '¿Razón principal de permanencia?',                                        opciones: ['Me encanta, quiero jubilarme','Estabilidad y beneficios','Sin otra opción','Buscando otro trabajo'], tipo: 'categorica' },
  // BLOQUE 2 – Liderazgo
  { id: 4,  bloque: 2, idx: 3,  texto: 'Mi jefe me mantiene informado sobre cambios importantes'                 },
  { id: 5,  bloque: 2, idx: 4,  texto: 'Mi jefe comunica claramente lo que espera de mi'                         },
  { id: 6,  bloque: 2, idx: 5,  texto: 'Puedo hacer preguntas sin temor a ser regañado/a o humillado/a'          },
  { id: 7,  bloque: 2, idx: 6,  texto: 'Mi jefe es accesible y es fácil hablar con él/ella'                      },
  { id: 8,  bloque: 2, idx: 7,  texto: 'Mi jefe dirige la sucursal de manera competente'                         },
  { id: 9,  bloque: 2, idx: 8,  texto: 'Mi jefe realiza reuniones para retroalimentar nuestro trabajo'           },
  { id: 10, bloque: 2, idx: 9,  texto: 'Mi jefe cumple con las promesas que hace'                                },
  { id: 11, bloque: 2, idx: 10, texto: 'Mi jefe reconoce mi esfuerzo y el trabajo adicional'                     },
  { id: 12, bloque: 2, idx: 11, texto: 'Mi jefe toma en cuenta mis ideas para mejorar los procesos'              },
  { id: 13, bloque: 2, idx: 12, texto: 'Mi jefe demuestra interés en mí como persona, no solo como trabajador/a' },
  { id: 14, bloque: 2, idx: 13, texto: 'Mi jefe me corrige de manera constructiva para ayudarme a mejorar'       },
  // BLOQUE 3 – Cultura
  { id: 15, bloque: 3, idx: 14, texto: 'Mi lugar de trabajo es psicológica y emocionalmente saludable'           },
  { id: 16, bloque: 3, idx: 15, texto: 'Mi lugar de trabajo es físicamente agradable y cálido'                   },
  { id: 17, bloque: 3, idx: 16, texto: 'Siento que puedo ser yo mismo/a en mi lugar de trabajo'                  },
  { id: 18, bloque: 3, idx: 17, texto: 'Existe sentimiento de familia o equipo dentro de la empresa'             },
  { id: 19, bloque: 3, idx: 18, texto: 'En una emergencia puedo contar con mis compañeros para cubrir mi turno'  },
  // BLOQUE 4 – Compensación
  { id: 20, bloque: 4, idx: 19, texto: 'Recibo una remuneración acorde al trabajo que realizo'                   },
  { id: 21, bloque: 4, idx: 20, texto: 'La empresa ofrece opciones claras y justas para mejorar mi salario'      },
  { id: 22, bloque: 4, idx: 21, texto: 'Todos somos tratados con justicia, sin importar sexo, rango o posición'  },
  { id: 23, bloque: 4, idx: 22, texto: 'Tengo oportunidades de crecimiento dentro de esta empresa'               },
  // BLOQUE 5 – Compromiso
  { id: 24, bloque: 5, idx: 23, texto: 'Me siento orgulloso/a cuando se alcanzan las metas de ventas'            },
  { id: 25, bloque: 5, idx: 24, texto: 'Estoy dispuesto/a a dar un esfuerzo extra para que mi trabajo sea excelente' },
  { id: 26, bloque: 5, idx: 25, texto: 'Está en mis planes seguir trabajando aquí por mucho tiempo'              },
  { id: 27, bloque: 5, idx: 26, texto: 'Me siento orgulloso/a de decir que trabajo en La Popular / La Salud'     },
  { id: 28, bloque: 5, idx: 27, texto: 'Creo que los clientes están satisfechos con la atención de nuestra sucursal' },
  // BLOQUE 6 – Autovaloración
  { id: 29, bloque: 6, idx: 28, texto: '¿Cómo calificaría su relación con sus compañeros?',                      opciones: ['Excelente – nos apoyamos siempre','Buena – solo relación profesional','Regular – a veces hay tensiones','Difícil – prefiero trabajar solo/a'] },
  { id: 30, bloque: 6, idx: 29, texto: 'Me considero una persona optimista y proactiva'                          },
  { id: 31, bloque: 6, idx: 30, texto: '¿Qué calificación se otorga como trabajador/a? (1–10)',                  tipo: 'numerica' },
  { id: 32, bloque: 6, idx: 31, texto: '¿Cuál es su nivel de compromiso actual con los objetivos?',              opciones: ['Muy alto','Alto','Medio','Bajo – estoy desmotivado/a'] },
  { id: 33, bloque: 6, idx: 32, texto: 'Estoy trabajando activamente en mejorar mis habilidades y debilidades'  },
  { id: 34, bloque: 6, idx: 33, texto: 'Cuando tengo una inconformidad, ¿con quién la comunico primero?',        opciones: ['Jefe inmediato','Supervisión o administración','Compañeros','No lo comunico – me lo guardo'], tipo: 'categorica' },
  // BLOQUE 7 – Alta Dirección
  { id: 35, bloque: 7, idx: 34, texto: 'Confío en las decisiones que toma la dirección de la empresa'           },
  { id: 36, bloque: 7, idx: 35, texto: 'La dirección de la empresa predica con el ejemplo'                      },
  { id: 37, bloque: 7, idx: 36, texto: 'La dirección nos informa claramente sobre cambios estratégicos'         },
  { id: 38, bloque: 7, idx: 37, texto: 'Confío en que la dirección tomará medidas tras los resultados de esta encuesta' },
  // BLOQUE 8 – Situación Financiera
  { id: 39, bloque: 8, idx: 38, texto: 'La situación financiera de la empresa está en su mejor momento'         },
  { id: 40, bloque: 8, idx: 39, texto: 'Siento que mi puesto de trabajo está seguro en la empresa'              },
  { id: 41, bloque: 8, idx: 40, texto: 'Siento que el puesto de algún compañero está seguro en la empresa'      },
  { id: 42, bloque: 8, idx: 41, texto: 'Creo que la empresa va a recortar personal durante este año',           invertida: true },
];
