// Puntos Salud: las cuentas de Niveles y Premios, el expediente que se abre al
// escanear la tarjeta y el mensaje del código por WhatsApp. Todo vive en el
// núcleo para que el portal y la app del personal digan lo mismo; acá se fija.
import { describe, expect, it } from 'vitest';
import {
    dolaresDePremio, numeroONulo, premioTexto, premiosTexto, diferenciasDeConfig, sujetoDelHistorial,
    esperadoDelRaspable, parteEnRegalos, costoDelRaspableTexto, probabilidadDePremio,
    filaDePremio, premiosLimpios, premiosCanonicos, formDeNivel, cambiosDeNivel, cambiosDeRango, formDeRango,
    dondeSeRetiraElPremio, detalleDelPremio, faltaEnRegalo,
} from '@nucleo/utils/nivelesDePuntos';
import {
    leerEntradaDeTarjeta, marcasDelCliente, estadoDeLaApp, pendientesDelCliente,
} from '@nucleo/utils/expedienteDelCliente';
import { telefonoParaWhatsapp, mensajeDelCodigo } from '@nucleo/utils/codigoDePuntos';

describe('nivelesDePuntos — premios en palabras', () => {
    it('100 puntos = US$1.00', () => {
        expect(dolaresDePremio(300)).toBe('$3.00');
        expect(dolaresDePremio('x')).toBe('$0.00');
    });

    it('numeroONulo: vacío y nulo son null, el cero es cero', () => {
        expect(numeroONulo('')).toBeNull();
        expect(numeroONulo(null)).toBeNull();
        expect(numeroONulo(undefined)).toBeNull();
        expect(numeroONulo('0')).toBe(0);
        expect(numeroONulo('2.5')).toBe(2.5);
    });

    it('cada tipo de premio se dice distinto', () => {
        expect(premioTexto({ puntos: 1500 })).toBe('1,500 pts');
        expect(premioTexto({ tipo: 'producto', cantidad: 2, nombre: 'MICROPORE' })).toBe('2 × MICROPORE');
        expect(premioTexto({ tipo: 'producto', cantidad: 1, nombre: 'MICROPORE' })).toBe('MICROPORE');
        expect(premioTexto({ tipo: 'promocional', nombre: 'Termo Salud' })).toBe('Termo Salud');
        expect(premiosTexto([{ puntos: 100, peso: 3 }, { tipo: 'promocional', nombre: 'Termo', peso: 1 }]))
            .toBe('100 pts (3) · Termo (1)');
        expect(premiosTexto([])).toBe('ninguno');
        expect(premiosTexto(null)).toBe('ninguno');
    });
});

describe('nivelesDePuntos — historial', () => {
    it('diferenciasDeConfig nombra el campo y traduce los valores, ignorando clave y orden', () => {
        const d = diferenciasDeConfig(
            { clave: 'oro', orden: 1, factor: 2, desde: 500, niveles_activos: false, cupon_presupuesto_mensual: null, nombre: 'Oro' },
            { clave: 'oro', orden: 2, factor: 3, desde: 1000, niveles_activos: true, cupon_presupuesto_mensual: 50, nombre: 'Oro' },
        );
        expect(d).toEqual([
            'Puntos por cada $1: 2 → 3',
            'Compra en 12 meses desde: $500.00 → $1,000.00',
            'Niveles encendidos: No → Sí',
            'Tope del raspable al mes: sin tope → 50',
        ]);
    });

    it('un campo que aparece o desaparece se lee con «—», y uno desconocido con su clave', () => {
        expect(diferenciasDeConfig({}, { horas_reserva: 24 })).toEqual(['Horas para retirar una reserva: — → 24']);
        expect(diferenciasDeConfig({ raro: 1 }, null)).toEqual(['raro: 1 → —']);
        expect(diferenciasDeConfig({ cupon_premios: null }, { cupon_premios: [{ puntos: 50, peso: 1 }] }))
            .toEqual(['Premios del raspable: ninguno → 50 pts (1)']);
    });

    it('sujetoDelHistorial dice de qué fila habla, con el nombre si se conoce', () => {
        const niveles = [{ clave: 'oro', nombre: 'Oro' }];
        const mayoreo = [{ clave: 'jade', nombre: 'Jade' }];
        expect(sujetoDelHistorial({ tabla: 'config' }, niveles, mayoreo)).toBe('Programa');
        expect(sujetoDelHistorial({ tabla: 'nivel', clave: 'oro' }, niveles, mayoreo)).toBe('Nivel Oro');
        expect(sujetoDelHistorial({ tabla: 'mayoreo', clave: 'jade' }, niveles, mayoreo)).toBe('Mayoreo Jade');
        expect(sujetoDelHistorial({ tabla: 'nivel', clave: 'plata' }, niveles, null)).toBe('Nivel plata');
    });
});

describe('nivelesDePuntos — costo del raspable', () => {
    const tabla = [
        { puntos: 100, peso: 3 },
        { puntos: 500, peso: 1 },
        { tipo: 'promocional', nombre: 'Termo', peso: 1 },
        { puntos: 9999, peso: 0 },        // peso 0: no sale nunca
    ];

    it('el esperado pondera por peso y los regalos cuentan como 0 puntos', () => {
        // (100×3 + 500×1 + 0×1) / 5 = 160
        expect(esperadoDelRaspable(tabla, 0)).toBe(160);
        expect(parteEnRegalos(tabla)).toBe(20);
    });

    it('sin premios con peso, vale el defecto', () => {
        expect(esperadoDelRaspable([], 75)).toBe(75);
        expect(esperadoDelRaspable([{ puntos: 10, peso: 0 }], '30')).toBe(30);
        expect(esperadoDelRaspable(null, null)).toBe(0);
        expect(parteEnRegalos([])).toBe(0);
    });

    it('el texto del costo menciona los regalos sólo si los hay, y es null si no cuesta nada', () => {
        expect(costoDelRaspableTexto(tabla, 0))
            .toBe('Cada raspable cuesta en promedio 160 puntos ($1.60) en puntos; además 20% de las veces sale un regalo.');
        expect(costoDelRaspableTexto([{ puntos: 200, peso: 1 }], 0)).toBe('Cada raspable cuesta en promedio 200 puntos ($2.00).');
        expect(costoDelRaspableTexto([{ tipo: 'promocional', peso: 1 }], 0)).toBeNull();
        expect(costoDelRaspableTexto([], 0)).toBeNull();
    });

    it('probabilidadDePremio con un decimal, o «—» si la tabla no pesa', () => {
        expect(probabilidadDePremio(tabla, tabla[0])).toBe('60%');
        expect(probabilidadDePremio([{ peso: 1 }, { peso: 2 }], { peso: 1 })).toBe('33.3%');
        expect(probabilidadDePremio([], { peso: 1 })).toBe('—');
    });
});

describe('nivelesDePuntos — formulario de premios y de nivel', () => {
    it('filaDePremio pasa todo a texto y premiosLimpios lo devuelve a número', () => {
        const guardado = { tipo: 'producto', peso: 2, product_id: 7, presentacion_tipo: 'CAJA', factor: 10, cantidad: 3, nombre: 'Gasa' };
        const fila = filaDePremio(guardado);
        expect(fila).toMatchObject({ tipo: 'producto', peso: '2', cantidad: '3', puntos: '' });
        expect(premiosLimpios([fila])).toEqual([guardado]);
        expect(filaDePremio({ puntos: 100, peso: 1 })).toMatchObject({ tipo: 'puntos', puntos: '100', cantidad: '1' });
    });

    it('premiosLimpios descarta las filas a medio llenar', () => {
        expect(premiosLimpios([
            { tipo: 'puntos', puntos: '100', peso: '' },                     // sin peso
            { tipo: 'puntos', puntos: '', peso: '1' },                       // sin puntos
            { tipo: 'producto', peso: '1', product_id: 7, factor: 10 },      // sin presentación
            { tipo: 'promocional', peso: '1', promocional_id: null },        // sin regalo
            { tipo: 'desconocido', peso: '1' },
            { puntos: '50', peso: '2' },                                     // sin tipo = puntos
            { tipo: 'promocional', peso: '1', promocional_id: '4', nombre: 'Termo' },
        ])).toEqual([
            { puntos: 50, peso: 2 },
            { tipo: 'promocional', promocional_id: 4, nombre: 'Termo', peso: 1 },
        ]);
        expect(premiosLimpios(null)).toEqual([]);
    });

    it('premiosCanonicos ignora el orden de las claves, no el de los premios', () => {
        expect(premiosCanonicos([{ puntos: 1, peso: 2 }])).toBe(premiosCanonicos([{ peso: 2, puntos: 1 }]));
        expect(premiosCanonicos([{ puntos: 1, peso: 1 }, { puntos: 2, peso: 1 }]))
            .not.toBe(premiosCanonicos([{ puntos: 2, peso: 1 }, { puntos: 1, peso: 1 }]));
    });

    const nivel = {
        nombre: 'Oro', desde: 500, factor: 2, puntos_cumpleanos: 200, horas_reserva: 24, dias_anticipo_ofertas: null,
        cupon_premios: [{ puntos: 100, peso: 1 }],
    };

    it('sin tocar nada, cambiosDeNivel no manda nada', () => {
        expect(cambiosDeNivel(formDeNivel(nivel), nivel, true)).toEqual({});
    });

    it('sólo viaja lo que cambió, con el nombre recortado y vacío como null', () => {
        const f = { ...formDeNivel(nivel), nombre: '  Oro Plus ', factor: '3', dias_anticipo_ofertas: '' };
        expect(cambiosDeNivel(f, nivel, false)).toEqual({ nombre: 'Oro Plus', factor: 3 });
    });

    it('el raspable sólo se compara si el nivel lo tiene, y vaciarlo manda null', () => {
        const f = { ...formDeNivel(nivel), cupon_premios: [] };
        expect(cambiosDeNivel(f, nivel, false)).toEqual({});
        expect(cambiosDeNivel(f, nivel, true)).toEqual({ cupon_premios: null });
    });

    it('cambiosDeRango compara el cumpleaños como número y el raspable igual que el nivel', () => {
        const rango = { puntos_cumpleanos: 300, cupon_premios: null };
        expect(cambiosDeRango(formDeRango(rango), rango, true)).toEqual({});
        expect(cambiosDeRango({ ...formDeRango(rango), puntos_cumpleanos: '350' }, rango, false)).toEqual({ puntos_cumpleanos: 350 });
        expect(cambiosDeRango({ ...formDeRango(rango), cupon_premios: [{ puntos: '20', peso: '1' }] }, rango, true))
            .toEqual({ cupon_premios: [{ puntos: 20, peso: 1 }] });
    });
});

describe('nivelesDePuntos — premios por entregar y regalos', () => {
    const sala = (id) => `Salud ${id}`;

    it('dónde se retira: apartado, esperando envío, entregado o en cualquier sucursal', () => {
        expect(dondeSeRetiraElPremio({ reserva_branch: 2 }, sala)).toBe('Apartado en Salud 2');
        expect(dondeSeRetiraElPremio({ espera_envio: true, branch_id: 4 }, sala)).toBe('Pedido para Salud 4 · esperando el envío');
        expect(dondeSeRetiraElPremio({ estado: 'ENTREGADO', entregado_branch: 1 }, sala)).toBe('Entregado en Salud 1');
        expect(dondeSeRetiraElPremio({ estado: 'POR_RETIRAR' }, sala)).toBe('Se retira en cualquier sucursal');
    });

    it('detalleDelPremio arma el renglón con lo que haya', () => {
        expect(detalleDelPremio({ codigo: 'PS-000123', tipo: 'producto', presentacion: 'CAJA', nivel: 'Oro' }))
            .toBe('PS-000123 · Producto · CAJA · Raspable Oro');
        expect(detalleDelPremio({ codigo: 'PS-9', tipo: 'promocional' })).toBe('PS-9 · Regalo promocional');
    });

    it('faltaEnRegalo: nombre al crear, cantidad y motivo al ajustar, origen y destino al enviar', () => {
        expect(faltaEnRegalo('nuevo', { nombre: ' T ' })).toBe('Escribe el nombre.');
        expect(faltaEnRegalo('editar', { nombre: 'Termo' })).toBeNull();

        expect(faltaEnRegalo('entrada', { cantidad: '3' })).toBe('Elige la sucursal.');
        expect(faltaEnRegalo('entrada', { sala: 1, cantidad: '0' })).toMatch(/cantidad/);
        expect(faltaEnRegalo('entrada', { sala: 1, cantidad: '1.5' })).toMatch(/cantidad/);
        expect(faltaEnRegalo('entrada', { sala: 1, cantidad: '-2', nota: 'x' })).toBe('Para restar, di por qué.');
        expect(faltaEnRegalo('entrada', { sala: 1, cantidad: '-2', nota: 'roto' })).toBeNull();
        expect(faltaEnRegalo('entrada', { sala: 1, cantidad: '5' })).toBeNull();

        expect(faltaEnRegalo('enviar', { sala: 1, cantidad: '2' })).toBe('Elige de dónde y a dónde.');
        expect(faltaEnRegalo('enviar', { sala: 1, hacia: '1', cantidad: '2' })).toBe('Tienen que ser sucursales distintas.');
        expect(faltaEnRegalo('enviar', { sala: 1, hacia: 2, cantidad: '-1' })).toBe('Escribe cuántos se mandan.');
        expect(faltaEnRegalo('enviar', { sala: 1, hacia: 2, cantidad: '2' })).toBeNull();
    });
});

describe('expedienteDelCliente — lo que llega del lector', () => {
    it('el código de la tarjeta, en mayúsculas y sin guiones', () => {
        expect(leerEntradaDeTarjeta('acd-efgh')).toEqual({ tipo: 'codigo', valor: 'ACDEFGH' });
        expect(leerEntradaDeTarjeta('  ACDEFGH\n')).toEqual({ tipo: 'codigo', valor: 'ACDEFGH' });
    });

    it('un código con letras que se confunden (O, I, S…) no es un código', () => {
        expect(leerEntradaDeTarjeta('ACDEFGO').tipo).toBe('nada');
        expect(leerEntradaDeTarjeta('ACDEF').tipo).toBe('nada');
    });

    it('el QR trae la dirección entera: se toma el parámetro', () => {
        expect(leerEntradaDeTarjeta('https://portal.farmasalud.lat/mis-puntos?codigo=ACDEFGH'))
            .toEqual({ tipo: 'codigo', valor: 'ACDEFGH' });
        expect(leerEntradaDeTarjeta('https://x/mis-puntos?a=1&codigo=acdefgh#z'))
            .toEqual({ tipo: 'codigo', valor: 'ACDEFGH' });
    });

    it('un lector con el teclado en otro idioma rompe los signos: se toman los últimos siete', () => {
        expect(leerEntradaDeTarjeta('https:--portal.farmasalud.lat-mis-puntos_codigo¿ACDEFGH'))
            .toEqual({ tipo: 'codigo', valor: 'ACDEFGH' });
    });

    it('nueve dígitos son un DUI; de ocho a once, un teléfono', () => {
        expect(leerEntradaDeTarjeta('01234567-8')).toEqual({ tipo: 'dui', valor: '012345678' });
        expect(leerEntradaDeTarjeta('7012-3456')).toEqual({ tipo: 'telefono', valor: '70123456' });
        expect(leerEntradaDeTarjeta('+503 7012 3456')).toEqual({ tipo: 'telefono', valor: '50370123456' });
        expect(leerEntradaDeTarjeta('1234567').tipo).toBe('nada');
        expect(leerEntradaDeTarjeta('123456789012').tipo).toBe('nada');
    });

    it('un nombre no se busca por acá', () => {
        expect(leerEntradaDeTarjeta('JUAN PEREZ')).toEqual({ tipo: 'nada', valor: '' });
        expect(leerEntradaDeTarjeta(null)).toEqual({ tipo: 'nada', valor: '' });
    });
});

describe('expedienteDelCliente — lo que se dice del cliente', () => {
    it('las marcas que cambian cómo se le vende, en orden', () => {
        expect(marcasDelCliente({
            es_empleado: true,
            mayorista: { estado: 'aprobado', precio: 'mayoreo_plus' },
            cliente: { acumula: false },
            nivel: { nombre: 'Oro' },
        }).map(m => m.rotulo)).toEqual(['Empleado', 'Precio mayoreo plus', 'Convenio: no acumula', 'Nivel Oro']);
        expect(marcasDelCliente({ mayorista: { estado: 'solicitado' } })[0].rotulo).toBe('Mayorista en trámite');
        expect(marcasDelCliente({ mayorista: { estado: 'aprobado', precio: 'raro' } })[0].rotulo).toBe('Mayorista');
        // acumula ausente NO es «no acumula»
        expect(marcasDelCliente({ cliente: {} })).toEqual([]);
        expect(marcasDelCliente(null)).toEqual([]);
    });

    it('estadoDeLaApp: nunca la abrió, cerró sesión, o la tiene y desde dónde', () => {
        expect(estadoDeLaApp(null)).toBeNull();
        expect(estadoDeLaApp({ alguna_vez: false })).toBeNull();
        expect(estadoDeLaApp({ alguna_vez: true, sesiones: 0 })).toEqual({ tiene: false, rotulo: 'Cerró sesión en la app', avisos: false });
        expect(estadoDeLaApp({ alguna_vez: true, sesiones: 2, plataformas: ['ios', 'android'], avisos: 1, ultimo_uso: '2026-10-01' }))
            .toEqual({ tiene: true, rotulo: 'Tiene la app (iPhone y Android)', avisos: true, ultimoUso: '2026-10-01' });
        expect(estadoDeLaApp({ alguna_vez: true, sesiones: '1' }).rotulo).toBe('Tiene la app');
    });

    it('pendientesDelCliente suma reservas, encargos e inyecciones', () => {
        expect(pendientesDelCliente({ reservas: [1, 2], encargos: [1], inyecciones: [] })).toBe(3);
        expect(pendientesDelCliente({})).toBe(0);
        expect(pendientesDelCliente(null)).toBe(0);
    });
});

describe('codigoDePuntos — WhatsApp', () => {
    it('ocho dígitos son de El Salvador; once o más ya traen país; lo demás no se manda', () => {
        expect(telefonoParaWhatsapp('7012-3456')).toBe('50370123456');
        expect(telefonoParaWhatsapp('+503 7012 3456')).toBe('50370123456');
        expect(telefonoParaWhatsapp('+1 (305) 555-0100')).toBe('13055550100');
        expect(telefonoParaWhatsapp('123456789')).toBeNull();
        expect(telefonoParaWhatsapp(null)).toBeNull();
    });

    it('el mensaje saluda por el primer nombre y parte el código en dos', () => {
        expect(mensajeDelCodigo({ nombre: 'Ana María López', codigo: 'ACDEFGH', enlace: 'https://x/mis-puntos' }))
            .toBe('Hola Ana. Tu código para ver tus puntos es ACD-EFGH. Entra aquí: https://x/mis-puntos');
        expect(mensajeDelCodigo({ codigo: 'ACDEFGH', enlace: 'L' }))
            .toBe('Hola. Tu código para ver tus puntos es ACD-EFGH. Entra aquí: L');
    });
});
