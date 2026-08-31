// ─────────────────────────────────────────────────────────────────────────────
// La foto que se toma con el teléfono y llega a la computadora
// ─────────────────────────────────────────────────────────────────────────────
//
// Lo que se ancla acá no es «funciona»: son las propiedades de seguridad, que
// son invisibles mirando la pantalla y las únicas que hacen defendible que esta
// pantalla abra SIN sesión.
//
//   · el secreto del QR vale CINCO minutos y UN solo uso;
//   · la foto viaja REDUCIDA — mandar 5 MB por datos móviles es lo que tumbó
//     `leer-dui` por memoria, y un avatar no los necesita;
//   · la computadora no se queda esperando para siempre si el canal en vivo no
//     conecta: hay un sondeo debajo.
//
// El ciclo completo (sirve → guarda → el segundo intento se rechaza) se probó
// contra la base dentro de una transacción deshecha, que es donde vive esa
// lógica; acá se vigila que el lado del navegador no la contradiga.

import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { enlaceDeCaptura } from '../../src/data/capturaDeFoto';

const leer = (rel) => fs.readFileSync(path.join(process.cwd(), rel), 'utf8');

describe('el enlace del QR', () => {
    it('apunta a la pantalla del teléfono con el secreto', () => {
        // `window.location.origin` en jsdom.
        expect(enlaceDeCaptura('ABC123')).toMatch(/\/foto\/ABC123$/);
    });
});

describe('las propiedades que hacen defendible abrir sin sesión', () => {
    const sql = leer('supabase/migrations/20260827215918_las_tres_funciones_del_traspaso_de_foto.sql');
    // La guarda de quién puede ABRIR una captura se movió el 28-ago, así que
    // vive en su propia migración. Leer la vieja para afirmar algo sobre la
    // guarda de hoy es cómo una prueba se queda en verde diciendo una mentira.
    const sqlGuarda = leer('supabase/migrations/20260828155307_captura_de_foto_para_cualquier_adjunto.sql');
    // Sin los comentarios. La migración EXPLICA en prosa qué guarda se quitó, y
    // buscar `auth_can_edit_any` sobre el texto crudo la encuentra ahí: la
    // prueba fallaba sobre una migración correcta. Es el mismo error que el
    // detector de comentarios del gate de diseño — un regex sobre texto plano
    // no distingue el código de lo que se escribió sobre el código.
    const guardaSinComentarios = sqlGuarda.split('\n').filter(l => !l.trim().startsWith('--')).join('\n');

    it('el código vive cinco minutos', () => {
        expect(sql).toMatch(/interval '5 minutes'/);
    });

    it('es de un solo uso, y lo garantiza el UPDATE', () => {
        // La condición va DENTRO del UPDATE, no en un `if` previo: con el mismo
        // QR en dos teléfonos, sólo el primero escribe. Un chequeo antes del
        // UPDATE los dejaría pasar a los dos.
        const guardar = sql.slice(sql.indexOf('guardar_foto_de_captura'));
        expect(guardar).toMatch(/UPDATE public\.capturas_de_foto[\s\S]*?AND usada_el IS NULL/);
    });

    it('en la base vive el hash, nunca el secreto', () => {
        expect(sql).toMatch(/digest\(v_secreto, 'sha256'\)/);
        expect(sql).not.toMatch(/VALUES \(v_secreto/);
    });

    /* ── Abrir una captura pide SESIÓN, no el permiso de personal ───────────
     *
     * Hasta el 28-ago exigía `auth_can_edit_any(ARRAY['staff_list'])`, porque
     * nació para la foto del empleado. Desde que el QR sale en los 21 adjuntos
     * —bitácoras, bolsas, facturación, sucursales— esa guarda habría dejado
     * afuera a casi todo el mundo.
     *
     * Lo que la hace defendible no cambió: abrir una captura NO escribe en
     * ninguna tabla de negocio. Mete UNA imagen, cinco minutos, un solo uso, en
     * un formulario que la persona ya tiene abierto. GUARDAR ese formulario
     * sigue pidiendo el permiso del módulo. */
    it('para abrirla hay que tener ficha y sesión', () => {
        expect(sqlGuarda).toMatch(/IF v_yo IS NULL THEN RAISE EXCEPTION 'FORBIDDEN'/);
    });

    it('y ya NO exige el permiso de editar personal', () => {
        // La regresión que esta prueba tiene que cazar es que alguien vuelva a
        // pegarle la guarda vieja: el QR desaparecería de 20 de los 21 adjuntos
        // sin dar ningún error — simplemente no abriría.
        expect(guardaSinComentarios).not.toMatch(/auth_can_edit_any/);
    });

    it('anon no la alcanza', () => {
        expect(sqlGuarda).toMatch(/REVOKE EXECUTE[\s\S]*FROM PUBLIC, anon/);
    });

    it('abrir una nueva mata la anterior', () => {
        // Dos QR vivos son dos llaves, y la vieja se queda en una pantalla que
        // alguien dejó abierta.
        expect(sql).toMatch(/SET usada_el = now\(\)\s*\n\s*WHERE solicitada_por = v_yo/);
    });
});

describe('lo que hace el navegador', () => {
    const cliente = leer('src/data/capturaDeFoto.js');
    // El redimensionado vive del lado del TELÉFONO desde el 28-ago: mantenerlo
    // en el módulo de la computadora costaba 2 kB en cada vista que adjunta algo.
    const telefono = leer('src/data/capturaDesdeElTelefono.js');

    /* 1600 px y no 1024: a 1024 la letra chica de un documento deja de leerse,
     * y desde el 28-ago por acá entra cualquier adjunto, no sólo una cara. Se
     * eligió UN tamaño para los dos casos porque el teléfono no sabe para qué
     * es la foto — el QR no lo dice, y metérselo sería meter un dato en la
     * llave. */
    it('la foto se reduce antes de mandarla, a tamaño de DOCUMENTO', () => {
        expect(telefono).toMatch(/ladoMaximo = 1600/);
        expect(telefono).toMatch(/toDataURL\('image\/jpeg', 0\.85\)/);
    });

    it('una foto ya chica NO se agranda', () => {
        // Reescalar hacia arriba sólo agrega peso y le quita nitidez.
        expect(telefono).toMatch(/Math\.min\(1, ladoMaximo/);
    });

    it('esperar la foto NO depende sólo del canal en vivo', () => {
        // Si la suscripción no conecta —una red que bloquea websockets, una
        // pestaña dormida— el usuario se queda mirando un QR que ya sirvió.
        const esperar = cliente.slice(cliente.indexOf('export function esperarFoto'));
        expect(esperar).toMatch(/postgres_changes/);
        expect(esperar).toMatch(/setInterval/);
    });

    it('la foto entra al formulario como archivo, no como URL suelta', () => {
        // Así sigue el camino normal de guardado: una segunda rama para «vino
        // del teléfono» es otra que mantener y que se desincroniza.
        expect(cliente).toMatch(/new File\(\[blob\]/);
    });
});

describe('la pantalla del teléfono', () => {
    const vista = leer('src/views/CapturaDeFotoView.jsx');

    it('dice en qué estado está, siempre', () => {
        for (const t of ['comprobando', 'mandando', 'hecho', 'error']) {
            expect(vista).toContain(`'${t}'`);
        }
    });

    it('no ofrece reintentar cuando el código ya venció', () => {
        // Un botón que promete algo que no puede cumplir.
        expect(vista).toMatch(/!\/venció\|usó\/\.test\(motivo\)/);
    });
});

// ─────────────────────────────────────────────────────────────────────────────
// Las esquinas del papel: propuestas, pero corregibles — y CONECTADAS
// ─────────────────────────────────────────────────────────────────────────────
//
// El enderezado de perspectiva existía completo —`utils/perspectiva.js`, el
// efecto del editor, el conmutador— y NUNCA corría desde un adjunto: la lectura
// devolvía las cuatro esquinas y `FileField` no se las pasaba al editor. Una
// función entera muerta sin dar un error, que es exactamente por qué «lo de las
// esquinas no funciona del todo bien».
//
// Lo que se ancla es el CABLE, no el algoritmo: el algoritmo tiene sus pruebas
// y ninguna se enteró de que nadie lo llamaba.

describe('las cuatro esquinas del papel', () => {
    const field = fs.readFileSync(
        path.join(process.cwd(), 'src/components/common/FileField.jsx'), 'utf8');
    const editor = fs.readFileSync(
        path.join(process.cwd(), 'src/components/common/EditorDeDocumento.jsx'), 'utf8');
    const lienzo = fs.readFileSync(
        path.join(process.cwd(), 'src/components/common/LienzoDeEncuadre.jsx'), 'utf8');
    const telefono = fs.readFileSync(
        path.join(process.cwd(), 'src/views/CapturaDeFotoView.jsx'), 'utf8');

    it('el adjunto se las pasa al editor', () => {
        expect(field).toMatch(/esquinas=\{ajustando \? preparado_\?\.esquinas : \(sugerido\?\.esquinas \|\| null\)\}/);
    });

    /* Desde la reestructuración del 2026-08-29 las esquinas NO son un desvío:
     * son el recorte. Antes había que apretar un botón para llegar a ellas y el
     * recorte normal era una caja de proporción fija — que es de donde venía
     * casi toda la torpeza. */
    it('son el recorte, no un modo aparte al que haya que entrar', () => {
        expect(editor).toMatch(/<LienzoDeEncuadre/);
        expect(editor).not.toMatch(/setMarcandoEsquinas/);
    });

    it('se marcan sobre la foto tal como llegó', () => {
        // El enderezado ocurre al CONFIRMAR, no antes: mientras se marcan, lo
        // que se ve es la foto original. Marcar sobre una ya enderezada sería
        // corregir encima del error que se viene a corregir.
        // `esq` son los mismos `puntos`, ya ordenados y con el giro pedido
        // aplicado — la foto sigue siendo la que llegó.
        expect(editor).toMatch(/rectificarPapel\(imagen, esq\)/);
    });

    it('el resultado sale de la medida del papel, no de una lista de formas', () => {
        const componer = fs.readFileSync(
            path.join(process.cwd(), 'src/utils/componerDocumento.js'), 'utf8');
        expect(componer).toMatch(/medidaDelPapel\(enPx\)/);
        // Y se ajusta al papel real cuando se lo reconoce: carta, oficio o
        // cédula. Sin eso, la hoja sale «casi carta».
        expect(componer).toMatch(/medidaAjustada\(crudo\.ancho, crudo\.alto\)/);
        expect(editor).not.toMatch(/doc\.formas/);
    });

    /* Los tres gestos. Sin pellizco, poner una esquina con precisión en un
     * teléfono es imposible — y un teléfono sin pellizco no se siente lento, se
     * siente roto. */
    it('se pellizca y se gira con los dedos', () => {
        expect(lienzo).toMatch(/useGestos\(marcoRef/);
        expect(lienzo).toMatch(/useRueda\(marcoRef/);
    });

    // Sin `touch-action: none` el navegador se queda con el gesto para
    // desplazar la página: el arrastre se corta solo a mitad de camino, y en
    // escritorio funciona perfecto — la peor combinación para darse cuenta.
    it('el lienzo no le cede el gesto al navegador', () => {
        expect(lienzo).toMatch(/touch-none/);
    });

    // El dedo tapa la esquina que está colocando.
    it('hay lupa mientras se arrastra una esquina', () => {
        expect(lienzo).toMatch(/lupaRef/);
        expect(lienzo).toMatch(/drawImage\(imagen/);
    });

    /* La regla no cambió; cambió DÓNDE termina la foto al confirmar.
     *
     * Hasta el 2026-08-30 confirmar mandaba (`mandar(listo)`). Desde que el
     * teléfono junta varias hojas en un solo escaneo, confirmar SUMA la hoja y
     * mandar es un botón aparte. Lo que se sigue vigilando es lo mismo: que la
     * foto pase por el editor y no salga cruda de la cámara. */
    it('el teléfono abre el editor en vez de mandar la foto tal cual', () => {
        expect(telefono).toMatch(/lazy\(\(\) => import\('\.\.\/components\/common\/EditorDeDocumento'\)\)/);
        // Confirmar suma una hoja; nunca manda desde el editor.
        expect(telefono).toMatch(/onConfirm=\{\(listo\) => \{[\s\S]{0,200}?setHojas\(/);
        expect(telefono).not.toMatch(/onConfirm=\{\(listo\) => \{[^}]*mandarFoto/);
    });
});

// ─────────────────────────────────────────────────────────────────────────────
// El documento se prepara SOLO al elegir el archivo
// ─────────────────────────────────────────────────────────────────────────────
//
// Pedido del usuario (2026-08-29): «al subir la foto, automáticamente detectar
// las esquinas, cuadrar y mejorar perspectiva, aplicar filtro». Antes esas
// cuatro cosas existían pero como un TRABAJO —abrir el editor, esperar la
// propuesta, confirmar—, y quien adjunta seis documentos de un expediente decía
// que sí seis veces. Un paso que siempre se confirma sin mirar no protege nada.
//
// Lo que hace aceptable el automatismo es lo que se ancla acá: se ve qué pasó y
// corregirlo cuesta un toque.

describe('preparar el documento solo', () => {
    const field = fs.readFileSync(
        path.join(process.cwd(), 'src/components/common/FileField.jsx'), 'utf8');
    const auto = fs.readFileSync(
        path.join(process.cwd(), 'src/data/prepararDocumento.js'), 'utf8');
    const editor = fs.readFileSync(
        path.join(process.cwd(), 'src/components/common/EditorDeDocumento.jsx'), 'utf8');

    it('elegir una imagen dispara la preparación, no el editor', () => {
        expect(field).toMatch(/prepararAutomatico\(archivo, tipoDeDocumento\)/);
    });

    // Si la lectura no encuentra las cuatro esquinas NO se inventa un recorte:
    // recortar por donde no va y adjuntarlo en silencio es peor que pedir
    // treinta segundos de trabajo.
    it('si no se reconoce el documento, se abre el editor como antes', () => {
        expect(auto).toMatch(/no se reconoció el documento/);
        expect(field).toMatch(/} else \{\s*\n\s*setPorEditar\(archivo\);/);
    });

    it('lo que hizo se DICE, y «Ajustar» lo reabre donde estaba', () => {
        expect(field).toMatch(/Recortado y enderezado/);
        expect(field).toMatch(/setAjustando\(true\); setSugerido\(null\); setPorEditar\(preparado_\.original\)/);
        // Con las esquinas ya detectadas: reabrir en el encuadre por defecto
        // haría perder el trabajo que el portal ya hizo bien.
        expect(field).toMatch(/esquinas=\{ajustando \? preparado_\?\.esquinas/);
    });

    // Dos tuberías para el mismo resultado se separan sin avisar: el archivo que
    // el portal prepara solo y el que sale de «Ajustar» y confirmar sin cambiar
    // nada tienen que ser el mismo.
    it('el automático y el editor usan la MISMA tubería', () => {
        for (const fuente of [auto, editor]) {
            expect(fuente).toMatch(/rectificarPapel\(/);
            expect(fuente).toMatch(/aArchivo\(/);
        }
    });

    it('y al ajustar no se vuelve a preguntar por las esquinas', () => {
        // Una respuesta distinta le cambiaría el encuadre a quien vino justo a
        // corregirlo.
        expect(field).toMatch(/if \(!porEditar \|\| ajustando\) return undefined;/);
    });
});

// ─────────────────────────────────────────────────────────────────────────────
// El marco se mide SIN la transformación del diálogo
// ─────────────────────────────────────────────────────────────────────────────
//
// El usuario mandó la foto de un DUI: el recuadro no caía sobre el documento.
// No era el modelo — era la medición.
//
// El diálogo entra con una animación de ESCALA. `getBoundingClientRect` devuelve
// la caja YA TRANSFORMADA, así que medir durante esos milisegundos daba un marco
// un 7 % más chico: medido, 1255×640 cuando el marco real era 1348×688. Y lo
// peor es lo que viene después: `ResizeObserver` informa la caja SIN
// transformar, o sea que al terminar la animación no cambia nada y NUNCA vuelve
// a disparar. El marco se quedaba con el número equivocado para siempre.
//
// Con eso, la foto se dibujaba a una escala y las esquinas se calculaban con
// otra: el polígono salía corrido 47 px a la izquierda y 23 hacia arriba.
// Medido después del arreglo: desvío 0.
//
// `clientWidth`/`clientHeight` son la caja de contenido sin transformar — la
// misma que mira el `ResizeObserver`—, así que las dos fuentes dicen lo mismo.

describe('el marco del encuadre', () => {
    const lienzo = fs.readFileSync(
        path.join(process.cwd(), 'src/components/common/LienzoDeEncuadre.jsx'), 'utf8');

    it('mide con `clientWidth`, no con la caja transformada', () => {
        expect(lienzo).toMatch(/el\.clientWidth/);
        expect(lienzo).toMatch(/el\.clientHeight/);
    });

    /* La regresión que hay que impedir: volver a `getBoundingClientRect` para
     * MEDIR EL MARCO. Se sigue usando —y está bien— para convertir la posición
     * del puntero, que llega en coordenadas de la ventana; eso ocurre con el
     * diálogo ya quieto. Por eso la prueba mira la función que mide, no el
     * archivo entero. */
    it('y la función que mide no lo usa', () => {
        const i = lienzo.indexOf('const medir = ');
        const j = lienzo.indexOf('medir();', i);
        expect(i).toBeGreaterThan(-1);
        expect(lienzo.slice(i, j)).not.toMatch(/getBoundingClientRect/);
    });
});

// ─────────────────────────────────────────────────────────────────────────────
// La foto que llega del teléfono YA está lista
// ─────────────────────────────────────────────────────────────────────────────
//
// «Tomé la foto desde el teléfono, la edité, apliqué filtro, y en la computadora
// volvió a pedirlo» (usuario, 2026-08-29).
//
// La foto entraba por el camino de siempre —editor incluido— y ese
// comportamiento era correcto cuando el teléfono sólo disparaba la cámara. Desde
// que el teléfono tiene su propio editor, llega recortada, enderezada y con su
// acabado: repetirlo en la computadora es pedir dos veces el mismo trabajo, y
// encima sobre una foto que ya se recortó.
//
// No hay caso en que llegue sin editar: en el teléfono la foto sólo se manda
// desde el `onConfirm` del editor — cancelar no manda nada.

describe('la foto del teléfono no se vuelve a preparar', () => {
    const field = fs.readFileSync(
        path.join(process.cwd(), 'src/components/common/FileField.jsx'), 'utf8');
    const telefono = fs.readFileSync(
        path.join(process.cwd(), 'src/views/CapturaDeFotoView.jsx'), 'utf8');

    it('entra marcada como ya preparada', () => {
        expect(field).toMatch(/fotoComoArchivo\(urlFirmada, 'foto\.jpg'\), \{ yaPreparado: true \}/);
    });

    it('y eso salta la preparación automática y el editor', () => {
        expect(field).toMatch(/if \(yaPreparado\) \{ onChange\?\.\(archivo\); return; \}/);
        // Antes que la rama de las imágenes: si quedara después, la prepararía
        // igual y la marca no serviría de nada.
        expect(field.indexOf('if (yaPreparado)'))
            .toBeLessThan(field.indexOf("archivo.type?.startsWith('image/')"));
    });

    it('el teléfono nunca manda al tomar la foto: pasa por el editor', () => {
        // Tomar una foto sólo la pone a ajustar.
        expect(telefono).toMatch(/setPorAjustar\(file\)/);
        // La única llamada a `enviar` sale de un botón, no del editor ni de
        // `tomar`: mandar es un acto aparte desde que hay varias hojas.
        expect(telefono).toMatch(/onClick=\{enviar\}/);
        expect(telefono).not.toMatch(/const tomar[\s\S]{0,400}?enviar\(/);
        // Y cancelar no manda nada ni deja hojas a medias.
        expect(telefono).toMatch(/onCancel=\{\(\) => \{ setPorAjustar\(null\); setSugerido\(null\); \}\}/);
    });
});

// ─────────────────────────────────────────────────────────────────────────────
// El pie del editor NO apila: es una barra de herramientas
// ─────────────────────────────────────────────────────────────────────────────
//
// «El modal en móvil no se ve bien, el botón confirmar se sale y crea scroll»
// (usuario, 2026-08-29, con la captura de un iPhone).
//
// El pie canónico, con el dedo, apila los botones a ancho completo
// (`[&_button]:w-full`) — correcto para un diálogo de «Cancelar / Aceptar». El
// editor tiene HERRAMIENTAS en el pie (girar, todo, el recorte sugerido) más la
// acción del paso, y esa regla las estiraba a 356 px dentro de una fila que no
// se parte: medido en un iPhone 13, el contenido del pie desbordaba 120 px en el
// encuadre y 68 en el acabado. Después de desactivarla: 0 y 0.

describe('el pie del editor en un teléfono', () => {
    const editor = fs.readFileSync(
        path.join(process.cwd(), 'src/components/common/EditorDeDocumento.jsx'), 'utf8');

    it('desactiva el ancho completo que impone el canónico', () => {
        expect(editor).toMatch(/<LiquidModal\.Footer className="\[&_button\]:w-auto!"/);
    });

    /* Y la acción del paso se lleva el ancho que sobra: es lo que el pulgar
     * acierta sin mirar. En escritorio no crece — ahí un botón de 900 px sería
     * absurdo. */
    it('la acción principal crece sólo con el dedo', () => {
        const veces = (editor.match(/flex-1 md:flex-none/g) || []).length;
        expect(veces).toBe(2);          // «Continuar» y «Guardar»
    });
});

// ─────────────────────────────────────────────────────────────────────────────
// Girar donde SE VE el resultado
// ─────────────────────────────────────────────────────────────────────────────
//
// «No me permite rotar» — dicho sobre el paso del acabado, que es donde se nota
// que el documento salió acostado. El botón sólo existía en el encuadre, donde
// lo que se ve es la FOTO y no el resultado: había que adivinar si hacía falta.

describe('el giro del editor', () => {
    const editor = fs.readFileSync(
        path.join(process.cwd(), 'src/components/common/EditorDeDocumento.jsx'), 'utf8');

    it('se puede girar también en el acabado', () => {
        expect(editor).toMatch(/const girarResultado = useCallback/);
        expect(editor).toMatch(/onClick=\{girarResultado\}/);
    });

    /* El giro es un CONTADOR y no una permutación de los puntos: el orden de los
     * puntos también lo cambia la mano al arrastrar una manija sobre otra, y
     * mezclando las dos cosas el documento salía girado sin que nadie lo
     * pidiera. */
    it('el giro se cuenta aparte del orden de las esquinas', () => {
        expect(editor).toMatch(/const \[cuartos, setCuartos\] = useState\(0\)/);
        expect(editor).toMatch(/ordenarEsquinas\(puntos\) \|\| puntos/);
        // Y ya no se permuta la lista de puntos para girar.
        expect(editor).not.toMatch(/setPuntos\(girarEsquinas\)/);
    });

    // En el encuadre lo que se ve es la foto, así que sin el número el botón
    // parece que no hace nada.
    it('el botón del encuadre dice cuánto se pidió', () => {
        expect(editor).toMatch(/Girar · \$\{cuartos \* 90\}°/);
    });
});
