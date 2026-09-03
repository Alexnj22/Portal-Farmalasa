import React, { useMemo, useEffect, useSyncExternalStore } from 'react';
import { Palmtree, Stethoscope, Baby, Clock, Briefcase, UserMinus, UserX, HelpCircle, Ban } from 'lucide-react';
import LiquidAvatar from './LiquidAvatar';
import { shortEmployeeName } from '../../utils/nameUtils';
import { estadoDePersona, estadoDesdeClave, normalizarPersona } from '../../utils/estadoDePersona';
import { useStaffStore } from '../../store/staffStore';
import { leerEstado, pedirEstado, suscribirse } from '../../data/estadosDePersonas';

/**
 * AvatarConEstado — la foto de una persona, y si esa persona está o no.
 *
 * ── Por qué no es una píldora más ─────────────────────────────────────────
 * El primer intento puso el estado como un badge debajo de los cargos. El
 * usuario lo miró y dijo *«no distingo que está de vacación»*: quedaba cuarto
 * en una pila de badges y el de arriba —«Faltan 2 datos»— era del mismo ámbar,
 * del mismo tamaño y de la misma forma. **Un dato importante en el mismo
 * envase que los demás queda escondido, por bien que esté redactado.**
 *
 * El segundo intento apagó la foto a gris. También lo levantó: *«parece
 * muerto»*. Y es exacto — el gris es el vocabulario de «dado de baja», no el
 * de «vuelve el martes».
 *
 * ── El aro, y por qué es EL que sobrevive ─────────────────────────────────
 * Se eligió sobre otros cuatro tratamientos (halo, corona, arco inferior, foto
 * teñida) por una razón medible: **el aro no se encoge como un ícono.** En el
 * portal la foto va de 20 px —las firmas de bitácoras, los chips de pedidos, la
 * campana— a 160 px en la ficha del empleado, o sea ocho veces. Un ícono de 20
 * px en el escalón chico pasa a 7 y se vuelve una mancha; el aro sigue siendo
 * un círculo entero de color y su grosor es ABSOLUTO, no proporcional.
 *
 * Lo que se pierde al achicar no es el aro: es el chip. Por eso la escalera:
 *
 *   ≥ 48 px   aro + chip con ícono   → dice QUÉ pasa
 *   28–47 px  aro solo (2.5 px)      → dice QUE pasa algo
 *   < 28 px   aro de 2 px            → igual, y la palabra la pone el texto
 *
 * Ese último escalón no es una concesión: **en todos los sitios donde la foto
 * es chica, el nombre de la persona está escrito al lado**. Ahí el aro no
 * necesita explicar nada — alcanza con que llame la atención para ir a mirar. Y
 * el `title` lleva la frase completa a CUALQUIER tamaño, así que el dato nunca
 * depende de distinguir un color.
 *
 * ── Lo que queda pendiente y hay que saber ────────────────────────────────
 * Los estados se distinguen sólo por COLOR: ámbar (vacaciones), rojo
 * (incapacidad), violeta (permiso), verde azulado (apoyo). Con daltonismo
 * rojo-verde —alrededor de 1 de cada 12 hombres— ámbar, rojo y verde azulado
 * dejan de ser tres colores distintos, y eso pasa igual a 160 px que a 20. Se
 * le propuso al usuario codificar también la FORMA del aro (continuo,
 * punteado, doble) y eligió el aro a secas. Queda anotado acá porque el día que
 * alguien lo levante como hallazgo, ésta es la respuesta: se midió, se mostró y
 * se decidió. El `title` es hoy la red que lo cubre.
 *
 * ── Uso ───────────────────────────────────────────────────────────────────
 *     <AvatarConEstado emp={emp} px={52} />
 *
 * `px` es OBLIGATORIO y es un número, no una clase: la escalera necesita el
 * tamaño real y desde una clase de Tailwind no se puede leer. Es la misma razón
 * por la que `data-lugar` existe — en tiempo de render se sabe, desde afuera no.
 *
 * `radio` y `marco` existen para el sidebar y el kiosco, que son superficies
 * BESPOKE (§25.4): tienen sus propios tokens de borde y sus propios radios, y
 * meterles la caja de una tarjeta sería una regresión visual en el único sitio
 * del portal que a propósito no usa los tokens de superficie. Cuando hay
 * estado, el aro reemplaza al marco: dos bordes concéntricos leen como un
 * defecto de render, no como una marca.
 */

const MARCA = {
  warning:   { anillo: 'ring-warning',   chip: 'bg-warning-solid' },
  danger:    { anillo: 'ring-danger',    chip: 'bg-danger-solid' },
  neutral:   { anillo: 'ring-chart-8',   chip: 'bg-chart-8-solid' },
  'chart-9': { anillo: 'ring-chart-9',   chip: 'bg-chart-9-solid' },
  'chart-6': { anillo: 'ring-chart-6',   chip: 'bg-chart-6-solid' },
  'chart-3': { anillo: 'ring-chart-3',   chip: 'bg-chart-3-solid' },
  'chart-1': { anillo: 'ring-chart-1',   chip: 'bg-chart-1-solid' },
};

// Escritas LITERALES y no armadas con plantilla: Tailwind escanea strings del
// fuente, y con `ring-${variante}` no ve nada y no emite la clase — el aro
// saldría sin color y en silencio. Es la trampa que `Badge.jsx` documenta en su
// tabla SOLID, y que ya costó tres variantes invisibles una vez.

const ICONO = {
  VACATION:   Palmtree,
  DISABILITY: Stethoscope,
  SUPPORT:    Briefcase,
  INDUCTION:  Baby,
  PERMIT:     Clock,
  INACTIVO:   UserMinus,
  LIQUIDADO:  UserX,
  SUSPENDIDO: HelpCircle,
  // El evento del Art. 83, que es lo que de verdad se escribe. `SUSPENDIDO` de
  // arriba sale de `employees.status` y hoy no lo pone nadie — se deja porque
  // el CHECK lo admite y una clave sin ícono sale sin color y en silencio.
  SUSPENSION: Ban,
  // «No está hoy», sin motivo: el reloj es lo más neutro que hay para decir
  // «ahora no» sin insinuar por qué.
  AUSENTE:    Clock,
};

export default function AvatarConEstado({ emp: crudo, px, className = '', mostrarChip = true,
                                          radio = 'rounded-xl', marco = 'border border-border-card' }) {
  // El portal muestra a la misma gente con seis formas de objeto distintas
  // según de qué consulta salga. `normalizarPersona` las acepta todas — ver su
  // nota en `utils/estadoDePersona.js`.
  const emp = useMemo(() => normalizarPersona(crudo), [crudo]);
  // ── El estado se busca en la ficha, aunque quien llame no la tenga ────────
  //
  // La mitad de los sitios donde sale una foto no pasa un empleado completo:
  // el sidebar tiene el objeto de la SESIÓN —que no lleva historial—, y los
  // chips de pedidos y las firmas de bitácoras pasan {id, name, photo}. Si el
  // aro dependiera de que el llamador traiga `history`, el estado aparecería en
  // unas pantallas y en otras no, sin que nada fallara — que es exactamente el
  // silencio que este componente vino a cerrar.
  //
  // Así que si el objeto no trae historial, se resuelve por id contra el store,
  // que es la única fuente. `find` devuelve la referencia que ya está en el
  // array, no un objeto nuevo, así que el selector no dispara renders de más.
  //
  // ── Y la FOTO se resuelve igual, por la misma razón (2026-09-03) ─────────
  //
  // Durante un año esto valió sólo para el estado, y la foto salía del objeto
  // que llegara. O sea que `emp={{ id, name }}` —que es lo que uno escribe
  // cuando la consulta ya trae el id de la persona— pintaba la INICIAL. Y no
  // se ve como un defecto: dibujar la inicial es exactamente lo que este
  // componente debe hacer cuando de verdad no hay foto, así que el resultado
  // de pasarle medio objeto es indistinguible del de una persona sin retrato.
  //
  // Lo reportó el usuario dos veces sobre la misma pantalla —la ficha de un
  // crédito, donde el vendedor salía con cara y quien cobró con la inicial—, y
  // la segunda vez ya existían tanto el comentario que lo explicaba como la
  // migración que había agregado el id al RPC *para* poder resolverlo. Faltaba
  // que alguien resolviera; ahora resuelve el componente y no el llamador.
  //
  // La ficha del store MANDA sobre lo que traiga el llamador: ahí `photo` es la
  // URL FIRMADA (la pone el arranque) y `photo_url` la cruda, que en un bucket
  // privado no se puede mostrar. Una consulta suelta que devuelva `photo_url`
  // sin pasar por `signPhotosDeep` trae la cruda, así que preferir la del store
  // arregla de paso la foto rota — no sólo la ausente.
  //
  // Si la persona no está en el store —la lista está ACOTADA por permisos, y
  // hay llamadores que pasan el id de la CUENTA y no el de la ficha— se cae a
  // lo que trajo el llamador, que es el comportamiento de siempre.
  const ficha = useStaffStore(s => {
    if (!emp?.id) return null;
    const faltaHistorial = !Array.isArray(emp.history);
    const faltaFoto = !emp.photo && !emp.photo_url;
    if (!faltaHistorial && !faltaFoto) return null;
    return (s.employees || []).find(e => String(e.id) === String(emp.id)) || null;
  });

  // ── Y cuándo el navegador NO puede saberlo solo ──────────────────────────
  //
  // Resolver contra el store parecía suficiente, y no lo era: esa lista está
  // ACOTADA. Quien no tiene `staff_list.can_view` recibe sólo los empleados de
  // su sucursal, y `employee_events` exige además `staff_detail` o `schedules`
  // para leer los eventos de otro — así que para el resto **el historial llega
  // vacío**, y un historial vacío es indistinguible de «esta persona no tiene
  // ausencias».
  //
  // Ahí el aro mentía en silencio: decía «está» sobre alguien de quien no sabía
  // nada. Es exactamente el silencio que el aro vino a cerrar, una capa más
  // abajo — y no se veía porque no falla nada.
  //
  // `historialCompleto` lo pone el arranque. Si es cierto, lo local alcanza y
  // no sale ni una petición. Si no, se le pregunta a la base, que responde el
  // motivo preciso a quien ya podía verlo y un «AUSENTE» a secas al resto: que
  // el aro nunca calle no puede costar que toda la empresa se entere de que
  // alguien está de incapacidad.
  const historialCompleto = useStaffStore(s => s.historialCompleto);
  const local = useMemo(() => estadoDePersona(ficha || emp), [ficha, emp]);

  const hayQuePreguntar = !historialCompleto && !local && !!emp?.id;

  // `useSyncExternalStore` y no un efecto con estado: el batcher vive fuera de
  // React, y suscribirse es justo lo que este hook existe para hacer — sin el
  // render en cascada que el proyecto prohíbe (`setState` dentro de un efecto).
  //
  // La lectura es PURA. React llama a `getSnapshot` varias veces por render
  // para comparar, así que pedir desde acá dispara la petición N veces y se
  // realimenta con el aviso que ella misma provoca — costó un proceso de
  // pruebas muerto sin mensaje. El pedido va en su efecto, abajo.
  const remoto = useSyncExternalStore(
    suscribirse,
    () => (hayQuePreguntar ? leerEstado(emp.id) : null),
    () => null,
  );

  useEffect(() => {
    if (hayQuePreguntar) pedirEstado(emp.id);
  }, [hayQuePreguntar, emp?.id]);

  // La base manda `{clave, hasta}`; el rótulo y el color los pone
  // `estadoDesdeClave`, el mismo que usa la rama local. Dos caminos, una sola
  // tabla de rótulos.
  const estado = local || (remoto ? estadoDesdeClave(remoto.clave, remoto.hasta, remoto.faltan) : null);

  const marca = estado ? MARCA[estado.variante] : null;
  const Icono = estado ? ICONO[estado.clave] : null;

  // Los tres escalones. `ring-[Npx]` con el número escrito: el grosor no puede
  // ser proporcional, porque eso es justo lo que hace desaparecer a un ícono.
  const grosor = px >= 28 ? 'ring-[2.5px]' : 'ring-2';
  const conChip = mostrarChip && px >= 48;

  /* Durante la cuenta regresiva el rótulo YA dice cuándo empieza («Vacaciones
     en 3 días»), así que «vuelve el 21» al lado sería una segunda fecha sobre
     algo que todavía no pasó: la frase quedaría con dos números y ninguno
     sería el que importa. Cuando ya empezó, la vuelta es justo lo que se busca. */
  const titulo = estado
    ? `${estado.texto}${estado.hasta && !estado.faltan ? ` · vuelve el ${estado.hasta}` : ''}`
    : undefined;

  return (
    <span
      className={`relative inline-flex shrink-0 ${className}`}
      style={{ width: px, height: px }}
      /* ── El conjunto ES un gráfico, y por eso se anuncia como uno ─────────
         Sin `role="img"`, el `title` cuelga de un `<span>` mudo: el lector de
         pantalla no lo lee y el gate de diseño lo marca con razón (§15.10).
         El rol va en el CONJUNTO —foto más aro— y no en el chip, porque lo que
         significa algo es el conjunto; el chip solo es un pedazo. Cuando la
         persona está presente no hay nada que anunciar y el rol no se pone: la
         foto ya se describe sola desde `LiquidAvatar`. */
      {...(estado ? { role: 'img', 'aria-label': titulo, title: titulo } : {})}
      /* Que la marca EXISTA es la pregunta que una prueba tiene que poder
         hacer, y desde afuera se contestaría por el color del aro — que es
         CSS, y jsdom no calcula ninguno. */
      data-estado={estado ? estado.clave : undefined}
    >
      {/* ⚠️ El aro va POR FUERA, sin `ring-inset`, y eso no es una preferencia.
          Una sombra interior se pinta encima del fondo del elemento pero DEBAJO
          de sus hijos, y acá el hijo es una foto que ocupa el 100% de la caja:
          con `ring-inset` el aro existía en el DOM, tenía su color, pasaba las
          pruebas —jsdom no compone capas— y era invisible en pantalla. Lo vio
          el usuario antes que cualquier gate: «¿y el aro de vacaciones?».
          Por fuera no ocupa espacio (una sombra nunca lo hace) y no lo recorta
          el `overflow-hidden`, que sólo recorta hijos. */}
      <span className={`block h-full w-full overflow-hidden ${radio}
        ${marca ? `${grosor} ${marca.anillo}` : marco}`}>
        <LiquidAvatar
          src={ficha?.photo || ficha?.photo_url || emp?.photo || emp?.photo_url}
          alt={emp?.name || 'Empleado'}
          fallbackText={shortEmployeeName(emp)}
          className="h-full w-full"
        />
      </span>

      {/* ── El chip: la palmera cuando YA está, el número mientras falta ─────
          «−3» y no un ícono, porque un ícono sólo puede decir QUÉ pasa y acá lo
          que hace falta es CUÁNDO. El signo menos va adelante: sin él, un «3»
          dentro de un círculo ámbar se lee como una cantidad —tres pendientes,
          tres avisos— y no como una cuenta regresiva.

          Cabe porque son dos caracteres como máximo (el aviso arranca en −5) y
          se dibuja con el mismo ancho que el ícono. Debajo de 48 px no hay
          chip y queda sólo el aro, igual que siempre: ahí la frase completa la
          lleva el `title`, que existe a cualquier tamaño. */}
      {/* `estado` va PRIMERO en la cadena, y esa posición es el arreglo: la
          guarda anterior era `conChip && Icono`, y `Icono` ya nace null cuando
          no hay estado —así que preguntaba por el estado sin nombrarlo—. Al
          agregarle la cuenta regresiva quedó `estado.faltan` a la cabeza, o sea
          una lectura sobre `null` para TODA persona presente con la foto de 48
          px o más: el aro dejó de ser un adorno opcional y pasó a tirar la
          vista entera al ErrorBoundary. Lo reportó el usuario como «el buscador
          de Carnés del día no funciona» y «Conexiones tampoco» — dos pantallas
          que no comparten nada salvo esta foto. */}
      {conChip && estado && (estado.faltan > 0 || Icono) && (
        <span
          className={`absolute -bottom-1 -right-1 flex items-center justify-center rounded-full
            border-2 border-surface-card shadow-sm ${marca.chip}`}
          style={{ width: Math.round(px * 0.34), height: Math.round(px * 0.34) }}
          /* Decorativo: su significado ya lo lleva el `aria-label` del
             conjunto, y anunciarlo aparte sería decir «palmera» después de
             decir «en vacaciones». */
          aria-hidden="true" data-chip-estado={estado.clave}
          data-faltan={estado.faltan > 0 ? estado.faltan : undefined}
        >
          {estado.faltan > 0 ? (
            <span
              className="font-black leading-none text-white tabular-nums"
              style={{ fontSize: Math.round(px * 0.17) }}
            >
              −{estado.faltan}
            </span>
          ) : (
            <Icono size={Math.round(px * 0.19)} strokeWidth={2.5} className="text-white" />
          )}
        </span>
      )}
    </span>
  );
}
