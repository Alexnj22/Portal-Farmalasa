#!/usr/bin/env node
// ═══════════════════════════════════════════════════════════════════════════
// Dibuja las hojas del mes de bitácoras SIN levantar el portal.
//
// Existe porque el papel es la única superficie del portal que nadie ve hasta
// que alguien la imprime en producción. `bitacoraPapel.js` no tiene un solo
// import justamente para que este archivo lo pueda cargar con node, armar el
// documento con datos de muestra y sacarle un PNG por hoja con Playwright.
//
// El PNG se saca del PDF que imprime Chromium —no de una captura de pantalla—
// así que lo que se mira es la paginación de verdad: dónde corta la hoja, si el
// encabezado se repite y si el libro sale acostado.
//
//   node scripts/maqueta-bitacoras.mjs [carpeta-de-salida]
// ═══════════════════════════════════════════════════════════════════════════

import { chromium } from 'playwright';
import fs from 'node:fs/promises';
import path from 'node:path';
import { armarHtmlDelMes, hojasDelMes } from '../src/utils/bitacoraPapel.js';

const SALIDA = process.argv[2] || 'maquetas-bitacoras';

// ── Datos de muestra ──────────────────────────────────────────────────────
// Cargados a mano y a propósito: la maqueta tiene que mostrar los casos que
// importan, no un mes bonito. Van la lectura fuera de rango, la que entró
// tarde, la corregida, el día sin anotar, el turno de limpieza incompleto y la
// dispensación anulada — que son los seis estados que el papel tiene que saber
// decir sin ayuda de un fondo de color.
// Con los nombres SEPARADOS, igual que los manda la RPC: el papel dice «primer
// nombre + primer apellido», y eso no se puede sacar partiendo el concatenado.
const PERSONAS = [
    { name: 'Katherine Salinas', first_names: 'Katherine Yamileth', last_names: 'Salinas Rivas' },
    { name: 'DOLORES CONCEPCION TEJADA HERNANDEZ', first_names: 'DOLORES CONCEPCION', last_names: 'TEJADA HERNANDEZ' },
    { name: 'Merlyn Aguilar', first_names: 'Merlyn Beatriz', last_names: 'Aguilar Portillo' },
];

const comoLaRpc = (p) => ({ por: p.name, por_nombres: p.first_names, por_apellidos: p.last_names });

const FRANJAS = [
    { clave: 'manana', label: 'Mañana', desde: '07:00:00', hasta: '09:00:00' },
    { clave: 'mediodia', label: 'Mediodía', desde: '12:00:00', hasta: '14:00:00' },
    { clave: 'tarde', label: 'Tarde', desde: '17:00:00', hasta: '19:00:00' },
];

const TURNOS = [
    { clave: 'manana', label: 'Mañana', desde: '07:00:00', hasta: '12:00:00' },
    { clave: 'tarde', label: 'Tarde', desde: '12:00:00', hasta: '19:00:00' },
];

const MUEBLES = Array.from({ length: 26 }, (_, i) => ({
    clave: `v${i + 1}`, label: `Vitrina ${i + 1}`,
}));

function diasDelMes(anio, mes) {
    const fin = new Date(Date.UTC(anio, mes, 0)).getUTCDate();
    return Array.from({ length: fin }, (_, i) =>
        `${anio}-${String(mes).padStart(2, '0')}-${String(i + 1).padStart(2, '0')}`);
}

function lecturasDe(dia, i, conHumedad) {
    return FRANJAS.map((f, j) => {
        // El 9 no se anotó de tarde y el 22 no se anotó en todo el día: un
        // hueco suelto y un día entero se leen distinto en la hoja.
        const n = Number(dia.slice(8, 10));
        if (n === 22 || (n === 9 && j === 2)) return { franja: f.clave, label: f.label, temperatura: null };
        const base = 24.4 + ((i * 7 + j * 3) % 9) * 0.4;
        const fuera = n === 17 && j === 1;
        return {
            franja: f.clave,
            label: f.label,
            temperatura: fuera ? 31.2 : Number(base.toFixed(1)),
            humedad: conHumedad ? 55 + ((i * 5 + j * 11) % 18) : null,
            fuera_de_rango: fuera,
            accion: fuera ? 'Se encendió el aire acondicionado y se reubicaron los termolábiles. Se verificó a las 13:20 con 27.8 °C.' : null,
            ...comoLaRpc(PERSONAS[(i + j) % PERSONAS.length]),
            hora: [`0${7 + j * 5}`.slice(-2), ':', String((12 + i * 7) % 60).padStart(2, '0')].join(''),
            tarde: n === 4 && j === 0,
            correcciones: n === 11 && j === 1 ? 1 : 0,
        };
    });
}

function limpiezasDe(dia, i) {
    const n = Number(dia.slice(8, 10));
    return TURNOS.map((t, j) => {
        if (n === 22 || (n === 14 && j === 1)) return { turno: t.clave, label: t.label, hecha: false };
        const faltan = n === 6 && j === 0 ? ['Vitrina 12', 'Vitrina 13'] : [];
        return {
            turno: t.clave,
            label: t.label,
            hecha: true,
            ...comoLaRpc(PERSONAS[(i + j) % PERSONAS.length]),
            observaciones: n === 19 && j === 0 ? 'Se repuso alcohol gel' : null,
            puntos_hechos: MUEBLES.length - faltan.length,
            puntos_total: MUEBLES.length,
            puntos_faltantes: faltan,
        };
    });
}

function areaConLecturas(nombre, opciones) {
    const dias = diasDelMes(2026, 8);
    return {
        nombre,
        tipo: opciones.tipo,
        temp_min: opciones.min ?? null,
        temp_max: opciones.max,
        mide_humedad: opciones.humedad,
        instrumento: opciones.instrumento,
        calibrado_hasta: opciones.calibrado,
        franjas: FRANJAS,
        limpiezas: [],
        puntos: [],
        dias: dias.map((d, i) => ({ dia: d, lecturas: lecturasDe(d, i, opciones.humedad), limpiezas: [] })),
    };
}

const MES = {
    periodo: '2026-08',
    sucursal: 'La Popular',
    direccion: 'Calle Morazán, frente al parque central, Chalatenango',
    desde: '2026-08-01',
    hasta: '2026-08-31',
    cerrado: true,
    cierre: {
        accion: 'cerrar',
        motivo: 'Se revisaron las 279 lecturas del mes. La desviación del 17 quedó documentada con su acción correctiva y la verificación posterior.',
        created_at: '2026-09-01T15:12:00Z',
        firmado_por: 'Lic. Hugo Alexander Rivera Menjívar',
    },
    resumen: {
        lecturas: { esperadas: 93, hechas: 89, faltantes: 4, tarde: 1, fuera_de_rango: 1, sin_accion: 0 },
        limpiezas: { esperadas: 62, hechas: 59, faltantes: 3 },
        correcciones: 1,
        calibracion_vencida: [],
    },
    areas: [
        areaConLecturas('Sala de ventas', {
            tipo: 'sala_ventas', max: 30, humedad: true,
            instrumento: 'Termohigrómetro digital HTC-2 · Serie 4471',
            calibrado: '2027-02-14',
        }),
        areaConLecturas('Bodega', {
            tipo: 'bodega', max: 30, humedad: true,
            instrumento: 'Termohigrómetro digital HTC-2 · Serie 4472',
            calibrado: '2027-02-14',
        }),
        {
            nombre: 'Vitrinas',
            tipo: 'otra',
            franjas: [],
            limpiezas: TURNOS,
            puntos: MUEBLES,
            mide_humedad: false,
            dias: diasDelMes(2026, 8).map((d, i) => ({ dia: d, lecturas: [], limpiezas: limpiezasDe(d, i) })),
        },
        {
            nombre: 'Servicio sanitario',
            tipo: 'otra',
            franjas: [],
            limpiezas: TURNOS,
            puntos: [{ clave: 's1', label: 'Servicio sanitario' }],
            mide_humedad: false,
            dias: diasDelMes(2026, 8).map((d, i) => ({
                dia: d,
                lecturas: [],
                limpiezas: limpiezasDe(d, i).map(l => ({ ...l, puntos_total: 1, puntos_hechos: 1, puntos_faltantes: [] })),
            })),
        },
    ],
    libro: [
        {
            folio: '2026-00041', fecha: '2026-08-03', hora: '10:24',
            producto: 'AMOXICILINA 500 MG CAPSULA', laboratorio: 'Laboratorios Vijosa',
            cantidad: 21, prescrito: 21, lote: 'A4471B', vence: '2028-04-30',
            paciente: 'Ana Beatriz Menjívar', documento: '04471223-5',
            medico: 'Dr. Carlos Ernesto Ramírez', numero_junta: 'JVPM-8842',
            receta: '2026-00118', vendedor: 'Katherine Salinas', estado: 'activa',
        },
        {
            folio: '2026-00042', fecha: '2026-08-07', hora: '16:02',
            producto: 'CIPROFLOXACINA 500 MG TABLETA RECUBIERTA', laboratorio: 'Laboratorios Suizos',
            cantidad: 10, prescrito: 14, lote: 'CP-2291', vence: '2027-11-30',
            paciente: 'José Rutilio Alemán', documento: '01128844-0',
            medico: 'Dra. Silvia Lorena Portillo', numero_junta: 'JVPM-6120',
            receta: '2026-00119', vendedor: 'Dolores Tejada', estado: 'activa',
        },
        {
            folio: '2026-00043', fecha: '2026-08-12', hora: '09:11',
            producto: 'AZITROMICINA 500 MG TABLETA', laboratorio: 'Laboratorios Paill',
            cantidad: 3, prescrito: 3, lote: 'AZ-0087', vence: '2028-01-31',
            paciente: 'María del Carmen Cruz', documento: '02290011-7',
            medico: 'Dr. Carlos Ernesto Ramírez', numero_junta: 'JVPM-8842',
            receta: '2026-00121', vendedor: 'Merlyn Aguilar', estado: 'activa',
        },
        {
            folio: '2026-00044', fecha: '2026-08-19', hora: '11:48',
            producto: 'CEFALEXINA 500 MG CAPSULA', laboratorio: 'Laboratorios Teramed',
            cantidad: 12, prescrito: 12, lote: 'CFX-771', vence: '2027-09-30',
            paciente: 'Rodrigo Alberto Sánchez', documento: '05512309-2',
            medico: 'Dra. Silvia Lorena Portillo', numero_junta: 'JVPM-6120',
            receta: '2026-00124', vendedor: 'Katherine Salinas',
            estado: 'anulada', motivo_anulacion: 'El paciente devolvió el medicamento sin abrir; se corrigió el folio.',
        },
    ],
};

// ── Dibujo ────────────────────────────────────────────────────────────────
async function main() {
    let logo = null;
    try {
        const bin = await fs.readFile('public/logo-farmacias.png');
        logo = { dataUrl: `data:image/png;base64,${bin.toString('base64')}` };
    } catch {
        console.warn('  (sin logo: no se encontró public/logo-farmacias.png)');
    }

    await fs.mkdir(SALIDA, { recursive: true });
    const html = armarHtmlDelMes(MES, logo);
    const htmlPath = path.join(SALIDA, 'bitacoras.html');
    await fs.writeFile(htmlPath, html);

    const navegador = await chromium.launch();
    const pagina = await navegador.newPage();
    await pagina.setContent(html, { waitUntil: 'load' });
    // El PDF es lo que sale de la impresora: si una hoja se parte en dos, acá
    // se ve. Una captura de pantalla mentiría sobre la paginación.
    const pdf = path.join(SALIDA, 'bitacoras.pdf');
    await pagina.pdf({ path: pdf, printBackground: true, preferCSSPageSize: true });
    await navegador.close();

    // ── Una hoja por área, y esto lo COMPRUEBA ────────────────────────────
    // «Una hoja por área» es una afirmación sobre la paginación, y la
    // paginación no se puede leer del CSS: depende de cuánto envuelve cada
    // nombre al ancho real de la página. Medir el alto en el navegador con el
    // viewport por defecto da un número que NO es el de la hoja —el texto
    // envuelve distinto— así que el único juez es el PDF. Si un cambio de
    // tipografía empuja las firmas a una página en blanco, esto falla acá y no
    // en la sala.
    const paginas = (await fs.readFile(pdf)).toString('latin1').match(/\/Type\s*\/Page[^s]/g)?.length ?? 0;
    const esperadas = hojasDelMes(MES, logo).length;
    console.log(`  ✓ ${htmlPath}`);
    console.log(`  ✓ ${pdf}`);
    if (paginas !== esperadas) {
        console.error(`\n  ✗ ${paginas} páginas para ${esperadas} hojas: alguna se partió en dos.`);
        console.error('    Revisá la hoja que sobra: casi siempre son las firmas empujadas por un renglón de más.');
        process.exitCode = 1;
        return;
    }
    console.log(`  ✓ ${paginas} páginas para ${esperadas} hojas — una hoja por área`);
    console.log('\n  Para verlas como imagen:');
    console.log(`    pdftoppm -r 110 -png ${pdf} ${path.join(SALIDA, 'hoja')}`);
}

main().catch((e) => { console.error(e); process.exit(1); });
