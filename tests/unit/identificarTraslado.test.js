import { describe, it, expect } from 'vitest';
import {
    identificarTrasladoNuevo,
    direccionesPorSucursal,
    textoDeTraslado,
} from '../../supabase/functions/_shared/erp-traslado.ts';
import real from './fixtures/traslados-2026-08-18.json';

// Cuál de los traslados nuevos es el propio.
//
// **Estas pruebas existen porque equivocarse acá mueve inventario ajeno.** El
// sistema de origen no devuelve el número del traslado que acaba de crear y su
// listado no respeta el orden que se le pide, así que el propio se deduce
// comparando la lista de pendientes de antes con la de después. Si en esos
// segundos alguien más despachó desde la misma ubicación, aparecen dos.
//
// El 2026-08-18 eso dejó NUEVE renglones sin número en los pedidos 119, 120 y
// 121 — entre ellos el BEBELAC 3 X 900 de Salud 3, que se quedó en tránsito:
// fuera de Bodega y sin entrar a la sala, o sea sin poder venderse. Los nueve
// por lo mismo: Bodega despachó una solicitud a mano (63 ese día, desde la
// misma ubicación) dentro de una ventana de 0,7 a 4,8 segundos.
//
// El fixture NO está inventado: son las páginas `ver_traslado.php` reales de
// los 18 traslados candidatos y el `<select id="id_sucursal">` real de la
// pantalla de traslado, capturados del sistema el 2026-08-19. `esperado` es el
// traslado que de verdad lleva ese producto, comprobado abriendo los 18.

/** El desempate no sale a la red: lee las páginas capturadas. */
const lector = (paginas) => async (_cookie, id) => textoDeTraslado(paginas[id] ?? '');

/**
 * Las dos fotos tal como estaban ese día: `antes` tiene lo que ya había,
 * `despues` agrega los dos candidatos con el destino que muestra el listado.
 */
function fotos(caso) {
    const antes = new Map([['1', 'VIEJO'], ['2', 'VIEJO']]);
    const despues = new Map(antes);
    // El primer candidato es el traslado ajeno; el segundo, el nuestro. Los dos
    // salen de la misma ubicación, que es justo lo que los vuelve indistinguibles.
    const dirNuestra = real.direccion_por_sala[String(caso.sala)];
    const ajeno = caso.destino_ajeno ?? dirNuestra;
    despues.set(caso.candidatos[0], ajeno);
    despues.set(caso.candidatos[1], dirNuestra);
    return { antes, despues };
}

describe('identificarTrasladoNuevo — los 9 renglones que quedaron sin número', () => {
    for (const caso of real.casos) {
        it(`${caso.clave} · ${caso.producto.replace(/\s+/g, ' ')} → ${caso.esperado}`, async () => {
            const { antes, despues } = fotos(caso);
            const r = await identificarTrasladoNuevo(
                'cookie', antes, despues, real.select_id_sucursal,
                caso.sala, [caso.producto], lector(caso.paginas),
            );
            expect(r.id).toBe(caso.esperado);
        });
    }

    it('los 9 quedan identificados, ninguno ambiguo', async () => {
        const ids = [];
        for (const caso of real.casos) {
            const { antes, despues } = fotos(caso);
            const r = await identificarTrasladoNuevo(
                'cookie', antes, despues, real.select_id_sucursal,
                caso.sala, [caso.producto], lector(caso.paginas),
            );
            ids.push(r.id);
        }
        expect(ids).toEqual(real.casos.map(c => c.esperado));
    });
});

describe('identificarTrasladoNuevo — cada vuelta por separado', () => {
    const caso = real.casos.find(c => c.clave === 'P121-S3-H1-I78511');   // el BEBELAC

    it('sin competencia, el propio es el único que no estaba', async () => {
        const antes = new Map([['1', 'VIEJO']]);
        const despues = new Map([['1', 'VIEJO'], [caso.candidatos[1], 'CUALQUIERA']]);
        const r = await identificarTrasladoNuevo(
            'cookie', antes, despues, real.select_id_sucursal,
            caso.sala, [caso.producto], lector(caso.paginas),
        );
        expect(r.id).toBe(caso.esperado);
    });

    // 5 de los 9 se resolvían sólo con esto: la solicitud que Bodega despachó a
    // mano iba a otra sala. Se comprueba sin dejar leer ninguna página, para que
    // la prueba falle si el desempate por destino deja de funcionar y el de
    // contenido lo tapa.
    it('el DESTINO alcanza cuando el ajeno va a otra sala', async () => {
        const antes = new Map();
        const despues = new Map([
            [caso.candidatos[0], real.direccion_por_sala['2']],   // el ajeno, a Salud 2
            [caso.candidatos[1], real.direccion_por_sala[String(caso.sala)]],
        ]);
        const r = await identificarTrasladoNuevo(
            'cookie', antes, despues, real.select_id_sucursal,
            caso.sala, [caso.producto], async () => { throw new Error('no debió leer ninguna página'); },
        );
        expect(r.id).toBe(caso.esperado);
    });

    // Los otros 4 iban a la MISMA sala. Es el caso del BEBELAC: el PEDIASURE
    // FRESA salió 2,9 s antes y también a Salud 3.
    it('con el mismo destino, desempata lo que llevan adentro', async () => {
        const { antes, despues } = fotos(caso);
        expect(new Set(despues.values()).size).toBe(2);   // 'VIEJO' + la sala: los dos candidatos comparten destino
        const r = await identificarTrasladoNuevo(
            'cookie', antes, despues, real.select_id_sucursal,
            caso.sala, [caso.producto], lector(caso.paginas),
        );
        expect(r.id).toBe(caso.esperado);
    });
});

describe('identificarTrasladoNuevo — prefiere no saber antes que equivocarse', () => {
    const caso = real.casos.find(c => c.clave === 'P121-S3-H1-I78511');

    it('si el ajeno lleva el MISMO producto, no elige: devuelve los dos', async () => {
        const { antes, despues } = fotos(caso);
        // Los dos candidatos con la misma página: indistinguibles de verdad.
        const paginas = {
            [caso.candidatos[0]]: caso.paginas[caso.candidatos[1]],
            [caso.candidatos[1]]: caso.paginas[caso.candidatos[1]],
        };
        const r = await identificarTrasladoNuevo(
            'cookie', antes, despues, real.select_id_sucursal,
            caso.sala, [caso.producto], lector(paginas),
        );
        expect(r.id).toBeNull();
        expect(r.candidatos.sort()).toEqual([...caso.candidatos].sort());
    });

    // La trampa que motivó la guarda: si la página del propio no carga y la del
    // ajeno sí, «el que no coincide se descarta» dejaría ganar al ajeno — y
    // recibir el traslado de otro mueve inventario que no es de esta sala.
    it('si una página no se pudo leer, no descarta a nadie', async () => {
        const { antes, despues } = fotos(caso);
        const paginas = {
            [caso.candidatos[0]]: caso.paginas[caso.candidatos[0]],
            [caso.candidatos[1]]: '',                                  // la nuestra no cargó
        };
        const r = await identificarTrasladoNuevo(
            'cookie', antes, despues, real.select_id_sucursal,
            caso.sala, [caso.producto], lector(paginas),
        );
        expect(r.id).toBeNull();
    });

    it('sin ningún candidato nuevo, no inventa uno', async () => {
        const antes = new Map([['1', 'VIEJO']]);
        const r = await identificarTrasladoNuevo(
            'cookie', antes, new Map(antes), real.select_id_sucursal,
            3, ['LO QUE SEA'], lector({}),
        );
        expect(r.id).toBeNull();
        expect(r.candidatos).toEqual([]);
    });
});

describe('las piezas que lee el sistema', () => {
    // El nombre del producto tiene que sobrevivir al recorte de etiquetas: si
    // no, el desempate por contenido no encuentra nada y todo queda ambiguo.
    it('textoDeTraslado deja el nombre del producto legible', () => {
        const caso = real.casos.find(c => c.clave === 'P121-S3-H1-I78511');
        const t = textoDeTraslado(caso.paginas[caso.esperado]);
        expect(t).toContain('BEBELAC 3 X 900 GR');
    });

    // `TE DE MANZANILLA  X 20 SOBRES` viene con DOS espacios en el catálogo del
    // portal y con uno en el sistema. Sin normalizar, ese renglón no se
    // identifica nunca.
    it('el doble espacio del catálogo no rompe la coincidencia', async () => {
        const caso = real.casos.find(c => c.clave === 'P121-S3-H10-I78635');
        expect(caso.producto).toContain('  ');                      // el dato real trae el doble espacio
        const { antes, despues } = fotos(caso);
        const r = await identificarTrasladoNuevo(
            'cookie', antes, despues, real.select_id_sucursal,
            caso.sala, [caso.producto], lector(caso.paginas),
        );
        expect(r.id).toBe(caso.esperado);
    });

    it('direccionesPorSucursal liga cada sala con su dirección', () => {
        const d = direccionesPorSucursal(real.select_id_sucursal);
        expect(d.size).toBe(6);                                     // las 6 salas de destino desde Bodega
        expect(d.get('3')).toContain('TOTOLCO');
        expect(d.get('2')).toContain('EL CALVARIO');
    });
});
