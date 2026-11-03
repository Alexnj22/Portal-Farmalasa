// La frase del día (2026-11-03, pedido del usuario: «una frase diaria,
// motivacional, médica… que la frase sea corta, todos los días a las 8 am
// debe estar lista»).
//
// Vive EN LA APP, no en el servidor: un diccionario fijo y una cuenta de días.
// Así está lista a las 8:00 sin cron, sin red y sin que nadie la cargue, y es
// la MISMA en todos los teléfonos el mismo día. El día cambia a las 8:00 de El
// Salvador (UTC−6, sin horario de verano): antes de esa hora sigue la de ayer.
//
// Tres canastas que se turnan (ánimo, salud, calma): el día `n` toma la
// canasta `n % 3` y, dentro de ella, la frase `⌊n/3⌋ % largo`. Cada canasta da
// la vuelta sola, así que agregar frases a una no desordena las otras.
//
// Reglas para agregar: corta (≤ 90 letras, que entre en tres renglones), sin
// autor —una cita mal atribuida es un dato falso con nuestra marca encima— y
// los consejos de salud, generales y prudentes: nada de dosis ni de «deja tu
// medicamento». Ante la duda, «consulta a tu médico».
import { useEffect, useState } from 'react';
import { AppState } from 'react-native';

export const CATEGORIAS = {
  animo: { nombre: 'Ánimo', sf: 'sparkles' },
  salud: { nombre: 'Salud', sf: 'heart.fill' },
  calma: { nombre: 'Calma', sf: 'leaf.fill' },
};

const ANIMO = [
  'Hoy es un buen día para empezar de nuevo.',
  'Un paso pequeño también es avanzar.',
  'No tienes que poder con todo hoy. Solo con lo de hoy.',
  'Lo que cuidas, crece. Empieza por ti.',
  'Eres más fuerte de lo que crees.',
  'La constancia le gana al talento que no se esfuerza.',
  'Haz hoy algo que tu yo de mañana te agradezca.',
  'Cada mañana trae una oportunidad nueva.',
  'Avanzar despacio sigue siendo avanzar.',
  'Tu esfuerzo de hoy es tu tranquilidad de mañana.',
  'Sonríe: es contagioso y no cuesta nada.',
  'Las cosas buenas toman su tiempo.',
  'Confía en el proceso, aunque no veas el final.',
  'Hoy, sé amable contigo.',
  'Una buena actitud cambia el día entero.',
  'Lo difícil no es imposible.',
  'Eres capaz de cosas que todavía no imaginas.',
  'El primer paso no tiene que ser perfecto.',
  'Celebra lo que ya lograste.',
  'Rodéate de quienes te hacen bien.',
  'Hoy puedes ser la razón de la sonrisa de alguien.',
  'Después de la tormenta, siempre sale el sol.',
  'La gratitud convierte lo que tienes en suficiente.',
  'No te compares: tu camino es solo tuyo.',
  'Hacer lo mejor que puedes ya es suficiente.',
  'Un error es una lección, no una derrota.',
  'Las ganas se encuentran haciendo.',
  'Tu historia todavía se está escribiendo.',
  'Pide ayuda: no es debilidad, es valentía.',
  'Lo que hoy cuesta, mañana se agradece.',
  'Tienes derecho a empezar otra vez, las veces que haga falta.',
  'El mejor momento para empezar es ahora.',
  'Mira cuánto has avanzado, no solo cuánto falta.',
  'La alegría está en las cosas sencillas.',
  'Pon el corazón en lo que haces.',
  'Hoy elige ver lo bueno.',
  'Un día a la vez.',
  'Tu valor no depende de lo que produces.',
  'Las metas grandes se logran con días pequeños.',
  'Respira hondo: puedes con esto.',
  'Sé paciente con tu propio ritmo.',
  'Lo que siembras con cariño, florece.',
  'Agradece una cosa hoy, aunque sea pequeña.',
  'Mereces el mismo cuidado que das a los demás.',
  'Cada día cuenta. Haz que cuente para bien.',
  'El ánimo también se entrena.',
  'Hoy puede ser el comienzo de algo bonito.',
  'No dejes para mañana la sonrisa de hoy.',
  'Una palabra amable puede cambiar un día.',
  'La familia es el mejor lugar para volver.',
  'Haz espacio para lo que te hace feliz.',
  'Lo que hoy parece mucho, mañana será experiencia.',
  'Disfruta el camino, no solo la meta.',
  'Llama a alguien que quieres. Hoy.',
  'La esperanza es un buen lugar para quedarse.',
  'Eres importante para más personas de las que crees.',
  'Termina el día orgulloso de algo, aunque sea pequeño.',
  'El cansancio pasa; lo que construyes, se queda.',
  'Que el miedo no decida por ti.',
  'Ríete más: el día se aligera.',
  'Hay días para correr y días para caminar. Los dos sirven.',
  'Hoy es un regalo. Ábrelo con calma.',
  'La bondad siempre regresa.',
  'Abraza tus pequeñas victorias.',
  'Tu mejor proyecto eres tú.',
  'Detrás de cada nube hay un cielo azul.',
  'Mañana será más fácil por lo que haces hoy.',
  'Lo sencillo también es valioso.',
  'Comparte lo bueno: se multiplica.',
  'El optimismo es una forma de cuidarte.',
  'No necesitas tenerlo todo claro para dar el siguiente paso.',
  'Hay belleza en volver a intentarlo.',
  'La paciencia también es fuerza.',
  'Hoy tienes una nueva página en blanco.',
  'Lo que te mueve por dentro vale la pena.',
  'Ser feliz también es una decisión diaria.',
  'Un buen día empieza con un buen pensamiento.',
  'Tu voz importa.',
  'Crece a tu ritmo, como las plantas.',
  'Rendirse nunca fue tu estilo.',
  'Dale a hoy tu mejor versión, la que sea posible.',
  'Lo que hoy aprendes, nadie te lo quita.',
  'Agradece a quien te cuida.',
  'Las buenas noticias también existen. Búscalas.',
  'Mereces descansar sin sentir culpa.',
  'Tu sonrisa le hace bien a alguien.',
  'Hoy puedes elegir la paz.',
  'Lo bueno que das, vuelve.',
  'Cree en ti como crees en quienes quieres.',
  'Cada amanecer es una segunda oportunidad.',
  'Haz las cosas con amor y salen mejor.',
  'Eres suficiente, tal como eres.',
  'Hoy es un buen día para ser feliz.',
  'Vamos por un día bonito.',
  'La vida se disfruta mejor acompañado.',
  'El cariño también cura.',
  'Tu bienestar es tu mejor inversión.',
  'Pequeños cambios, grandes resultados.',
  'Sigue: lo estás haciendo bien.',
  'Hoy, trátate como a tu mejor amigo.',
];

const SALUD = [
  'Toma agua durante el día, aunque no tengas sed.',
  'Caminar 30 minutos al día cuida tu corazón.',
  'Dormir bien también es salud: intenta de 7 a 8 horas.',
  'Lávate las manos con agua y jabón por 20 segundos.',
  'Los antibióticos solo con receta, y el tratamiento completo.',
  'Una fruta al día es un regalo para tu cuerpo.',
  'Usa protector solar, aunque esté nublado.',
  'Mide tu presión arterial de vez en cuando.',
  'Menos sal en la comida, más salud en tu corazón.',
  'No te automediques: pregúntale a tu farmacéutico.',
  'Revisa la fecha de vencimiento de tus medicamentos.',
  'Toma tus medicamentos a la misma hora cada día.',
  'Estirarte cada hora alivia la espalda y el cuello.',
  'Las verduras de colores aportan vitaminas distintas.',
  'Un chequeo a tiempo vale más que un tratamiento tarde.',
  'Cepilla tus dientes al menos dos veces al día.',
  'Guarda los medicamentos lejos del calor y la humedad.',
  'Mantén los medicamentos fuera del alcance de los niños.',
  'Si tienes fiebre por más de tres días, consulta a tu médico.',
  'Las bebidas azucaradas suman más azúcar de la que crees.',
  'Sube las escaleras: tu corazón te lo agradece.',
  'Con diarrea, el suero oral es tu mejor aliado.',
  'Elimina el agua estancada: así se previene el dengue.',
  'Usa repelente si hay zancudos cerca.',
  'Desayunar te da energía para empezar el día.',
  'Lee la etiqueta antes de tomar un medicamento.',
  'Pide a tu médico que te explique tu receta.',
  'Si eres diabético, revisa tus pies todos los días.',
  'La vacunación protege a ti y a quienes quieres.',
  'Mastica despacio: tu digestión lo nota.',
  'Las pantallas antes de dormir roban sueño.',
  'Una caminata después de comer ayuda a la digestión.',
  'Lleva una lista de tus medicamentos a cada consulta.',
  'Ventila tu casa: el aire fresco también cuida.',
  'Las legumbres son proteína buena y económica.',
  'Reduce los fritos: tu hígado te lo agradece.',
  'Si fumas, dejarlo es lo mejor que puedes hacer hoy.',
  'Cubre tu boca al toser o estornudar.',
  'El ejercicio también mejora el ánimo.',
  'Hidrátate más en los días de calor.',
  'No compartas tus medicamentos: cada receta es personal.',
  'Un dolor de pecho fuerte es una urgencia: busca ayuda ya.',
  'Mantén tu peso en un rango saludable, poco a poco.',
  'Cuida tu postura cuando estés sentado.',
  'Lava frutas y verduras antes de comerlas.',
  'Si un medicamento te cae mal, avísale a tu médico.',
  'El sol de la mañana ayuda a regular tu sueño.',
  'Ojos cansados: mira a lo lejos 20 segundos cada 20 minutos.',
  'Una porción de nueces o semillas es un buen refrigerio.',
  'La glucosa alta no siempre duele: contrólala.',
  'Bailar también cuenta como ejercicio.',
  'Tomar agua antes de comer ayuda a comer mejor.',
  'Revisa tu botiquín: que tenga lo básico y vigente.',
  'Duerme a la misma hora, también el fin de semana.',
  'El alcohol, mejor poco o nada.',
  'Lávate las manos antes de comer y después del baño.',
  'Los niños aprenden a comer sano viéndote a ti.',
  'Un buen calzado cuida tus rodillas y tu espalda.',
  'Ante un golpe de calor: sombra, agua y descanso.',
  'Si te duele la cabeza seguido, consulta a tu médico.',
  'Las alergias se controlan mejor con un diagnóstico.',
  'Come a tus horas: el cuerpo agradece la rutina.',
  'La fibra ayuda a tu digestión: avena, frutas y frijoles.',
  'Una buena risa relaja los músculos.',
  'Haz pausas activas si trabajas sentado.',
  'Cuida tus oídos: baja el volumen de los audífonos.',
  'El autocuidado incluye ir al médico.',
  'Si estás embarazada, consulta antes de tomar cualquier medicamento.',
  'La leche y los lácteos ayudan a tus huesos.',
  'Respira por la nariz: filtra y calienta el aire.',
  'Mueve los tobillos en viajes largos.',
  'Protege tus ojos del sol con lentes oscuros.',
  'El estrés también afecta la presión: date pausas.',
  'Un vaso de agua al despertar es un buen comienzo.',
  'Las heridas: lava con agua limpia y jabón.',
  'Pregunta siempre si tu medicamento se toma con comida.',
  'Mantén tus vacunas al día, también de adulto.',
  'Caminar con alguien hace el ejercicio más fácil.',
  'Las frutas enteras llenan más que los jugos.',
  'Desconéctate un rato del teléfono.',
  'Tu farmacéutico también resuelve dudas. Pregúntale.',
  'Un plato con colores es un plato completo.',
  'Si te mareas al levantarte, hazlo despacio.',
  'Hidratación también es sopa, fruta y agua de coco.',
  'Los controles de salud no son solo para cuando duele.',
  'Bañarte con agua tibia antes de dormir ayuda a descansar.',
  'Cuida tus manos: hidrátalas si se resecan.',
  'Sal a tomar aire fresco al menos un rato al día.',
  'Lo que comes hoy se nota en cómo te sientes mañana.',
  'Escucha a tu cuerpo: el cansancio también avisa.',
  'Un buen descanso fortalece tus defensas.',
  'No guardes medicamentos en el baño: la humedad los daña.',
  'Termina siempre el tratamiento que te indicaron.',
  'Si cuidas a alguien, cuídate también a ti.',
  'Subir y bajar los hombros alivia la tensión.',
  'Comer con calma es parte de comer bien.',
  'La salud mental también es salud.',
  'Toma el sol de la mañana unos minutos.',
  'Cada paso cuenta. Literal.',
];

const CALMA = [
  'Respira profundo tres veces. Así, sin prisa.',
  'Está bien ir despacio.',
  'No todo lo urgente es importante.',
  'Suelta lo que no depende de ti.',
  'Un descanso a tiempo es parte del trabajo.',
  'Inhala calma, exhala prisa.',
  'Este momento también va a pasar.',
  'Haz una cosa a la vez.',
  'El silencio también descansa.',
  'Escucha tu respiración un minuto.',
  'Hoy no tienes que tener todas las respuestas.',
  'Afloja la mandíbula y baja los hombros.',
  'La calma también se practica.',
  'Mira por la ventana un momento.',
  'Lo que sientes es válido.',
  'Un paseo corto aclara la mente.',
  'Decir «no» también es cuidarte.',
  'Date permiso de descansar.',
  'Escribe lo que te preocupa y suéltalo un rato.',
  'Pausa. Respira. Sigue.',
  'Tu mente también necesita vacaciones.',
  'Lo que no puedes cambiar, acéptalo con calma.',
  'Bebe algo caliente despacio y disfrútalo.',
  'Hoy elige la paz antes que tener la razón.',
  'Pon música que te guste y descansa cinco minutos.',
  'Tu ritmo está bien.',
  'Menos prisa, más presencia.',
  'La tranquilidad empieza por dentro.',
  'Cierra los ojos y cuenta hasta diez.',
  'Deja el teléfono a un lado un rato.',
  'Respirar lento le dice a tu cuerpo que está a salvo.',
  'No tienes que llenar cada minuto.',
  'Acepta el día como viene.',
  'Un buen pensamiento a la vez.',
  'Mira el cielo un momento.',
  'Estira los brazos y respira hondo.',
  'Aquí y ahora: eso es suficiente.',
  'Las preocupaciones pesan menos cuando se comparten.',
  'Tómate un minuto solo para ti.',
  'Lo que hoy no salió, mañana tiene otra oportunidad.',
  'Una sonrisa relaja más de lo que crees.',
  'Camina sin prisa, aunque sea un ratito.',
  'Agradece algo de este momento.',
  'Respira y siente tus pies en el suelo.',
  'Deja que las cosas tomen su tiempo.',
  'No te exijas lo que no le exigirías a otro.',
  'Desconectarte también es productivo.',
  'Escucha a la naturaleza un momento.',
  'Hoy suelta una preocupación.',
  'La calma es una forma de fuerza.',
  'Haz una pausa antes de responder.',
  'Un baño tibio puede cambiar la noche.',
  'Mira lo que ya está bien.',
  'Tu descanso es importante.',
  'Lo simple también tranquiliza.',
  'Escribe tres cosas buenas de hoy.',
  'Suelta la tensión de tus manos.',
  'Si te sientes abrumado, empieza por lo más pequeño.',
  'Busca un rincón tranquilo cinco minutos.',
  'Respira contando: entra en 4, sale en 6.',
  'No estás solo.',
  'Lo que piensas no siempre es lo que pasa.',
  'Permítete un momento sin hacer nada.',
  'El presente es el único lugar donde puedes estar.',
  'Hoy, menos exigencia y más cariño.',
  'Una taza de té y un respiro.',
  'Baja el ritmo: el día no se va a ir.',
  'Abraza a alguien hoy.',
  'Siente el aire entrar y salir.',
  'Lo que te preocupa tiene un tamaño. No lo agrandes.',
  'Ordena un espacio pequeño: también ordena la mente.',
  'Hoy elige un pensamiento amable.',
  'Escucha una canción que te traiga paz.',
  'La paz se cultiva con pausas.',
  'No hay prisa para sanar.',
  'Relaja la frente.',
  'Hoy está bien solo estar.',
  'Pide un momento cuando lo necesites.',
  'Lo que te hace bien, repítelo.',
  'Una caminata al atardecer calma el día.',
  'Respira como si tuvieras todo el tiempo del mundo.',
  'Mira tus logros con ternura.',
  'Tranquilo: paso a paso.',
  'Hoy, regálate silencio.',
  'Cuando todo corre, tú puedes caminar.',
  'Pon tu mano en el pecho y respira lento.',
  'Una cosa bien hecha vale más que diez a medias.',
  'El descanso no se gana: se necesita.',
  'Hay calma después de cada ola.',
  'Lo que sientes hoy no te define mañana.',
  'Suelta el control un ratito.',
  'Escucha más, apúrate menos.',
  'Haz espacio para respirar.',
  'Hoy, sé suave contigo.',
  'Un respiro profundo antes de seguir.',
  'La serenidad también es salud.',
  'Mira alrededor: hay algo bonito cerca.',
  'Termina el día soltando lo que pesó.',
  'Deja que el cuerpo descanse y la mente también.',
  'Respira. Estás aquí.',
];

const CANASTAS = [['animo', ANIMO], ['salud', SALUD], ['calma', CALMA]];

const HORA = 3_600_000;
const DIA = 24 * HORA;
// El Salvador es UTC−6 todo el año; el día de la frase empieza a las 8:00.
const DESFASE = (6 + 8) * HORA;

/** El número del día de la frase: sube a las 8:00 de El Salvador. */
export function diaDeFrase(ahora = Date.now()) {
  return Math.floor((ahora - DESFASE) / DIA);
}

/** Cuántos milisegundos faltan para la próxima frase (las 8:00 que vienen). */
export function msHastaLaSiguiente(ahora = Date.now()) {
  return (diaDeFrase(ahora) + 1) * DIA + DESFASE - ahora;
}

/** La frase de un día: `{ texto, categoria, dia }`. */
export function fraseDelDia(ahora = Date.now()) {
  const dia = diaDeFrase(ahora);
  const [categoria, lista] = CANASTAS[((dia % 3) + 3) % 3];
  const i = ((Math.floor(dia / 3) % lista.length) + lista.length) % lista.length;
  return { texto: lista[i], categoria, dia };
}

export const TOTAL_FRASES = ANIMO.length + SALUD.length + CALMA.length;

/**
 * La frase de hoy, y que cambie sola: a las 8:00 si la app está abierta, y al
 * volver a la app (el reloj de JavaScript no corre con la app dormida).
 */
export function useFraseDelDia() {
  const [frase, setFrase] = useState(() => fraseDelDia());
  useEffect(() => {
    let reloj = null;
    const poner = () => {
      clearTimeout(reloj);
      const f = fraseDelDia();
      setFrase((x) => (x.dia === f.dia ? x : f));
      // Un segundo de margen: que al despertar ya sea el día nuevo.
      reloj = setTimeout(poner, msHastaLaSiguiente() + 1_000);
    };
    poner();
    const sub = AppState.addEventListener('change', (e) => { if (e === 'active') poner(); });
    return () => { clearTimeout(reloj); sub.remove(); };
  }, []);
  return frase;
}
