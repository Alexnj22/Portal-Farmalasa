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
