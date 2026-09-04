/* «Así abrió la mañana», para la tarjeta del aviso.
 *
 * Gemelo de `datosDeCierreDelDia` (`cierreDeMeta.js`) y de
 * `datosDeFaltanteDeCaja` (`faltanteDeCaja.js`): lee el `metadata` del aviso y
 * devuelve `null` en cuanto falta lo mínimo, para que la campana vuelva sola a
 * su fila de texto en vez de dibujar una tarjeta a medias.
 *
 * ── La pregunta que la tarjeta contesta sin leer ───────────────────────────
 * No es «quién abrió» —eso es una lista y hay que leerla— sino **¿abrieron
 * todas y a tiempo?**. Las salas abren a las 7:00 y el aviso sale cuando abre
 * la última, así que el dato que se busca de un vistazo es CUÁL fue la última y
 * si se pasó de la hora. Por eso el anillo dibuja cuántas de las seis abrieron
 * y cada renglón se tiñe cuando su hora cruzó las 7:00.
 *
 * ── `quien` ausente NO es «no sé el nombre» ────────────────────────────────
 * Es «el portal no vio quién fue»: la caja se abrió desde su propia pantalla y
 * el único nombre que hay ahí es el de la CUENTA con la que la sala opera
 * siempre, que no es el de quien actuó. Llega `null` a propósito desde
 * `aperturas_de_la_manana()` y acá se conserva `null` para que la tarjeta lo
 * diga distinto —«desde la caja»— en vez de inventar una firma.
 */

/* Las siete en punto, en minutos. Es la hora a la que abren las salas, dicha
 * por el usuario, y acá sirve para UNA cosa: teñir el renglón que se pasó. La
 * hora TOPE del aviso (7:20) no vive acá sino en `sync-aperturas-caja`, que es
 * quien decide mandar — la tarjeta ya recibe la decisión tomada, y tener el
 * 7:20 escrito en dos lados sería un número que se desincroniza sin que nada
 * lo note. */
const LAS_SIETE = 7 * 60;

/** «07:05» → 425. `null` si no tiene esa forma. */
export function minutosDeHora(hhmm) {
    const m = /^(\d{1,2}):(\d{2})/.exec(String(hhmm ?? ''));
    if (!m) return null;
    return Number(m[1]) * 60 + Number(m[2]);
}

export function datosDeAperturasDeLaManana(n) {
    if (n?.type !== 'APERTURAS_DE_LA_MANANA') return null;
    const m = n.metadata || {};

    const total = Number(m.total);
    const abiertas = Number(m.abiertas);
    // Sin el denominador no hay anillo que dibujar, y un anillo sin escala
    // diría una proporción sobre un total que nadie sabe cuál es.
    if (!Number.isFinite(total) || total <= 0) return null;
    if (!Number.isFinite(abiertas)) return null;

    const lista = (Array.isArray(m.salas) ? m.salas : [])
        .filter((s) => s && s.sala && minutosDeHora(s.hora) != null)
        .map((s) => {
            const min = minutosDeHora(s.hora);
            return {
                branchId: s.branch_id ?? null,
                sala: String(s.sala),
                hora: String(s.hora),
                minutos: min,
                tarde: min > LAS_SIETE,
                employeeId: s.employee_id || null,
                // Se conserva el `null`: ver el encabezado.
                quien: s.quien ? String(s.quien) : null,
            };
        })
        .sort((a, b) => a.minutos - b.minutos);

    const textos = (v) => (Array.isArray(v) ? v.map(String).filter(Boolean) : []);

    return {
        total,
        abiertas,
        completa: abiertas >= total && total > 0,
        salas: lista,
        /* Las dos listas de lo que falta van SEPARADAS y no sumadas: «no abrió»
         * y «no se pudo comprobar» son hechos distintos, y juntarlos es
         * exactamente lo que convierte un rato de sistema caído en seis salas
         * acusadas de no abrir. */
        noAbrieron: textos(m.no_abrieron),
        sinRespuesta: textos(m.sin_respuesta),
        horaAviso: m.hora_aviso ? String(m.hora_aviso) : '',
        /* La última en abrir: es el número que se busca cuando todo salió bien.
         * Sale de la lista y no de un campo aparte para que no puedan decir
         * cosas distintas. */
        ultima: lista.length ? lista[lista.length - 1] : null,
        conRetraso: lista.some((s) => s.tarde),
    };
}
