// Tres piezas que son un PISO, no un techo — y una que evita un «undefined» en
// pantalla.
//
// Las tres primeras nacieron de la misma auditoría y del mismo hallazgo: una
// regla que cada llamador tiene que repetir es una regla que la mayoría se
// salta.
//
//   · **102 de los 194 botones `iconOnly`** del proyecto no tenían `aria-label`
//     ni `title`: un lector de pantalla los anunciaba como «botón» y nada más
//     (WCAG 4.1.2). Y 77 de esos 102 eran cuatro íconos cuyo significado no
//     admite duda, así que el arreglo correcto es UNO y no 102 ediciones;
//   · **18 íconos se dibujaban con 2 a 4 colores distintos**: el ojo aparecía
//     sin tono, `chart-1`, `success` y `secondary`; `Download` era `success` en
//     Personal y `chart-1` en Facturas de Compra. El mismo ícono significaba lo
//     mismo y se veía distinto según la pantalla;
//   · el buscador del menú tiene que encontrar «tardanzas» sin que nadie sepa
//     que el módulo se llama `time_audit`.

import { describe, it, expect } from 'vitest';
import { renderHook } from '@testing-library/react';
import { NOMBRE_POR_ICONO, TONO_POR_ICONO, CLASE_TEXTO_POR_TONO, VARIANTES_RELLENAS }
    from '../../src/components/common/iconNames';
import { MODULE_SEARCH_KEYWORDS } from '../../src/constants/menuSearchKeywords';
import useSobreviveAlCierre from '../../src/hooks/useSobreviveAlCierre';
import useMediaQuery from '../../src/hooks/useMediaQuery';
import { CORTE_TELEFONO, useExpedienteMovil } from '../../src/components/common/usarExpediente';

describe('el nombre que un botón de sólo ícono no tiene', () => {
    it('los cuatro íconos que eran 77 de los 102 tienen nombre', () => {
        expect(NOMBRE_POR_ICONO.X).toBe('Cerrar');
        expect(NOMBRE_POR_ICONO.ChevronLeft).toBe('Anterior');
        expect(NOMBRE_POR_ICONO.ChevronRight).toBe('Siguiente');
        expect(NOMBRE_POR_ICONO.ChevronDown).toBe('Expandir');
    });

    it('las variantes del mismo ícono dicen lo mismo', () => {
        // `X`, `XIcon` y `XCircle` son el mismo gesto: si dijeran cosas
        // distintas, el lector de pantalla contaría tres botones diferentes.
        expect(new Set([NOMBRE_POR_ICONO.X, NOMBRE_POR_ICONO.XIcon, NOMBRE_POR_ICONO.XCircle]).size).toBe(1);
        expect(NOMBRE_POR_ICONO.Trash).toBe(NOMBRE_POR_ICONO.Trash2);
        expect(NOMBRE_POR_ICONO.Pencil).toBe(NOMBRE_POR_ICONO.SquarePen);
    });

    it('ninguno queda vacío, y todos están en español', () => {
        for (const [icono, nombre] of Object.entries(NOMBRE_POR_ICONO)) {
            expect(nombre, icono).toBeTruthy();
            expect(nombre, icono).not.toMatch(/^[a-z]/);   // empieza en mayúscula, como una etiqueta
        }
    });

    it('opuestos que se distinguen: expandir no es contraer', () => {
        expect(NOMBRE_POR_ICONO.ChevronUp).not.toBe(NOMBRE_POR_ICONO.ChevronDown);
        expect(NOMBRE_POR_ICONO.Eye).not.toBe(NOMBRE_POR_ICONO.EyeOff);
        expect(NOMBRE_POR_ICONO.ZoomIn).not.toBe(NOMBRE_POR_ICONO.ZoomOut);
    });
});

describe('el tono que un ícono lleva por lo que SIGNIFICA', () => {
    it('lo que destruye es peligro, y lo que crea o confirma es éxito', () => {
        expect(TONO_POR_ICONO.Trash2).toBe('danger');
        expect(TONO_POR_ICONO.Trash).toBe('danger');
        for (const i of ['Plus', 'Check', 'CheckCircle2', 'Save']) expect(TONO_POR_ICONO[i], i).toBe('success');
    });

    it('modificar lo que ya existe avisa, no alarma', () => {
        expect(TONO_POR_ICONO.Pencil).toBe('warning');
        expect(TONO_POR_ICONO.SquarePen).toBe('warning');
    });

    it('cada tono declarado tiene su clase de texto', () => {
        // Un tono sin clase no falla: pinta sin color, y el ícono pierde
        // justamente lo que lo distingue.
        for (const [icono, tono] of Object.entries(TONO_POR_ICONO))
            expect(CLASE_TEXTO_POR_TONO[tono], `${icono} → ${tono}`).toBeTruthy();
    });

    it('las variantes RELLENAS no reciben tono', () => {
        // Su fondo ya es del color y el ícono va en blanco: teñirlo lo haría
        // desaparecer contra su propio fondo.
        expect([...VARIANTES_RELLENAS].sort()).toEqual(['destructive', 'primary']);
    });

    it('el mismo ícono no puede tener dos tonos', () => {
        // Es el defecto que este mapa vino a terminar.
        const claves = Object.keys(TONO_POR_ICONO);
        expect(new Set(claves).size).toBe(claves.length);
    });
});

describe('el buscador del menú encuentra sin saber el nombre del módulo', () => {
    it('«tardanzas» lleva a la auditoría de tiempos', () => {
        expect(MODULE_SEARCH_KEYWORDS.time_audit).toContain('tardanzas');
    });

    it('los sinónimos NO repiten el nombre del módulo: eso ya se busca solo', () => {
        for (const [modulo, palabras] of Object.entries(MODULE_SEARCH_KEYWORDS))
            expect(palabras, modulo).not.toContain(modulo);
    });

    it('van sin tildes, que es como la gente teclea a las apuradas', () => {
        for (const [modulo, palabras] of Object.entries(MODULE_SEARCH_KEYWORDS))
            for (const p of palabras)
                expect(p, `${modulo}: ${p}`).toBe(p.normalize('NFD').replace(/[̀-ͯ]/g, ''));
    });

    it('ningún módulo declara la lista vacía', () => {
        for (const [modulo, palabras] of Object.entries(MODULE_SEARCH_KEYWORDS)) {
            expect(Array.isArray(palabras), modulo).toBe(true);
            expect(palabras.length, modulo).toBeGreaterThan(0);
        }
    });
});

describe('lo que un diálogo sigue mostrando mientras SALE', () => {
    // `ModalShell` sigue montado ~240 ms haciendo su salida, pero el estado pasa
    // a `null` en el mismo tick: el panel no se cierra, **se vacía a la vista y
    // después desaparece**. El encabezado de Conexiones alcanzaba a decir
    // literalmente «undefined conexiones abiertas» con el avatar vacío.
    it('mientras hay valor, devuelve el valor', () => {
        const { result } = renderHook(({ v }) => useSobreviveAlCierre(v), { initialProps: { v: 'ana' } });
        expect(result.current).toBe('ana');
    });

    it('al pasar a nulo, sigue devolviendo el ÚLTIMO que hubo', () => {
        const { result, rerender } = renderHook(({ v }) => useSobreviveAlCierre(v),
                                                { initialProps: { v: 'ana' } });
        rerender({ v: null });
        expect(result.current).toBe('ana');
    });

    it('un valor nuevo reemplaza al anterior', () => {
        const { result, rerender } = renderHook(({ v }) => useSobreviveAlCierre(v),
                                                { initialProps: { v: 'ana' } });
        rerender({ v: 'luis' });
        expect(result.current).toBe('luis');
        rerender({ v: null });
        expect(result.current).toBe('luis');
    });

    it('arrancar en nulo devuelve nulo, no `undefined`', () => {
        const { result } = renderHook(() => useSobreviveAlCierre(null));
        expect(result.current).toBeNull();
    });

    it('`undefined` cuenta como cerrado, igual que `null`', () => {
        const { result, rerender } = renderHook(({ v }) => useSobreviveAlCierre(v),
                                                { initialProps: { v: 'ana' } });
        rerender({ v: undefined });
        expect(result.current).toBe('ana');
    });

    it('un CERO no cuenta como cerrado', () => {
        // Es el caso que rompen los `if (!valor)`: el id 0, o un contador en
        // cero, son valores legítimos que hay que seguir mostrando.
        const { result, rerender } = renderHook(({ v }) => useSobreviveAlCierre(v),
                                                { initialProps: { v: 5 } });
        rerender({ v: 0 });
        expect(result.current).toBe(0);
    });
});

describe('el corte del teléfono vive en UN lugar', () => {
    // `useMediaQuery` CACHEA el `MediaQueryList` por consulta —una sola vez por
    // cadena, para toda la vida del módulo—, así que reemplazar `matchMedia`
    // entre pruebas no cambia nada: la segunda lee el objeto de la primera. Por
    // eso `matches` acá es un GETTER sobre una bandera mutable, que es además
    // como se comporta el de verdad cuando la ventana cambia de tamaño.
    let coincide = true;
    const conMatchMedia = (v) => { coincide = v; };
    window.matchMedia = (q) => ({
        get matches() { return coincide; },
        media: q,
        addEventListener: () => {}, removeEventListener: () => {},
        addListener: () => {}, removeListener: () => {},
    });

    it('es el mismo que usa la tabla para decidir ficha o tabla', () => {
        // Está acá y no como número suelto en cada vista justamente para que no
        // puedan divergir: si lo hicieran, habría un ancho donde la fila es
        // ficha y el detalle intenta expandirse dentro de una tabla que ya no
        // está.
        expect(CORTE_TELEFONO).toBe('(max-width: 1023.98px)');
    });

    it('en el teléfono resuelve la fila abierta', () => {
        conMatchMedia(true);
        const filas = [{ id: 1, n: 'a' }, { id: 2, n: 'b' }];
        const { result } = renderHook(() => useExpedienteMovil(filas, 2));
        expect(result.current.enTelefono).toBe(true);
        expect(result.current.abierto).toEqual({ id: 2, n: 'b' });
    });

    it('en escritorio NO hay expediente, aunque haya fila abierta', () => {
        // Ahí la expansión de la tabla ya la muestra: pintar las dos sería
        // mostrar la misma fila dos veces.
        conMatchMedia(false);
        const { result } = renderHook(() => useExpedienteMovil([{ id: 1 }], 1));
        expect(result.current.enTelefono).toBe(false);
        expect(result.current.abierto).toBeNull();
    });

    it('acepta una FUNCIÓN de clave: no toda vista expande por una columna', () => {
        // Inventario agrupa por sucursal + producto y su estado es la cadena
        // «3_10452», que no vive en ninguna fila. Sin esto, esas vistas se
        // escribían su propio `useMediaQuery` al lado.
        conMatchMedia(true);
        const filas = [{ suc: 3, prod: 10452 }, { suc: 4, prod: 10452 }];
        const { result } = renderHook(() =>
            useExpedienteMovil(filas, '4_10452', f => `${f.suc}_${f.prod}`));
        expect(result.current.abierto).toEqual({ suc: 4, prod: 10452 });
    });

    it('sin fila abierta, o si el id no existe, no inventa una', () => {
        conMatchMedia(true);
        expect(renderHook(() => useExpedienteMovil([{ id: 1 }], null)).result.current.abierto).toBeNull();
        expect(renderHook(() => useExpedienteMovil([{ id: 1 }], 99)).result.current.abierto).toBeNull();
        expect(renderHook(() => useExpedienteMovil(null, 1)).result.current.abierto).toBeNull();
    });

    it('la media query se consulta sin romper si el navegador no la tiene', () => {
        // La consulta es única a propósito: el caché del módulo guarda una
        // entrada por cadena y reusarla acá leería la de otra prueba.
        const real = window.matchMedia;
        delete window.matchMedia;
        expect(renderHook(() => useMediaQuery('(sin-matchmedia: 1px)')).result.current).toBe(false);
        window.matchMedia = real;
    });
});
