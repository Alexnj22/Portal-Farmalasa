// ─────────────────────────────────────────────────────────────────────────────
// El rótulo de un campo y el instrumento que lo vigila
// ─────────────────────────────────────────────────────────────────────────────
//
// Dos cosas se anclan acá, y la segunda es la que casi se escapa.
//
// 1. El rótulo tiene ALTO FIJO. Escrito a mano, su alto salía de lo que le
//    pusieran adentro —15px sólo texto, 25 con «Requerido», 36 con un botón—,
//    así que dos campos vecinos arrancaban hasta 21px desalineados según si a
//    uno le tocaba una insignia. Medido con Chromium el 2026-08-26.
//
// 2. **El gate que vigila esto estuvo ciego sobre el archivo más grande.** Su
//    limpiador de comentarios era un regex `/\*[\s\S]*?\*\//`, y
//    `accept="image/*"` tiene un `/*` DENTRO DE UNA CADENA: lo tomó como
//    apertura de comentario y blanqueó 154,304 caracteres — el archivo entero
//    de ahí para abajo. O sea que varias categorías venían dando CERO sobre dos
//    tercios de `EmployeeFormModal.jsx`, y un cero así no se distingue de uno
//    de verdad.

import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { rotuloCampo, ALTO_ROTULO } from '../../src/utils/rotuloDeCampo';
import { blanquearComentarios } from '../../scripts/lib/blanquearComentarios.mjs';

const leer = (rel) => fs.readFileSync(path.join(process.cwd(), rel), 'utf8');

describe('rotuloCampo', () => {
    it('siempre trae el alto fijo, con o sin tono, denso o no', () => {
        for (const c of [rotuloCampo(), rotuloCampo('text-danger/80'), rotuloCampo('text-warning', { denso: true })]) {
            expect(c).toContain(ALTO_ROTULO);
        }
    });

    it('el alto no cambia con `denso` — sólo el tamaño del texto', () => {
        // Si el alto cambiara, volvería el mismo desalineado un nivel más abajo.
        expect(rotuloCampo('text-content-3', { denso: true })).toContain(ALTO_ROTULO);
        expect(rotuloCampo('text-content-3', { denso: true })).toContain('text-micro');
        expect(rotuloCampo('text-content-3')).toContain('text-caption');
    });

    it('acota el contenido: nada envuelve ni se sale', () => {
        // Con el alto puesto y sin acotar, un aviso largo parte en dos líneas y
        // se sale sobre el campo — medido: caja 20, contenido 27.
        const c = rotuloCampo();
        expect(c).toContain('overflow-hidden');
        expect(c).toContain('whitespace-nowrap');
    });

    it('el canónico del campo lo usa, no reescribe sus clases', () => {
        const input = leer('src/components/common/PortalInput.jsx');
        expect(input).toContain('rotuloCampo(');
        expect(input).not.toMatch(/className=\{`text-caption font-black uppercase tracking-widest/);
    });

    it('el alta de personal no escribe ni un rótulo a mano', () => {
        const form = leer('src/components/forms/EmployeeFormModal.jsx');
        expect(form).not.toMatch(/<label\s+className="[^"]*tracking-widest/);
    });
});

describe('blanquearComentarios (el limpiador del gate)', () => {
    it('NO trata un `/*` dentro de una cadena como comentario', () => {
        // El caso real que dejó ciego al gate.
        const src = '<input accept="image/*" />\nconst x = 1;\n<label className="a" />';
        const out = blanquearComentarios(src);
        expect(out).toContain('accept="image/*"');
        expect(out).toContain('<label className="a" />');
    });

    it('sí blanquea comentarios de verdad, conservando los saltos de línea', () => {
        const src = 'a\n/* uno\n   dos */\nb\n// tres\nc';
        const out = blanquearComentarios(src);
        expect(out).not.toContain('uno');
        expect(out).not.toContain('tres');
        expect(out.split('\n').length).toBe(src.split('\n').length);
        expect(out.split('\n')[0]).toBe('a');
        expect(out.split('\n').at(-1)).toBe('c');
    });

    it('una comilla escapada no lo saca de la cadena', () => {
        const src = 'const s = "dice \\" y sigue /* no es comentario */";\nconst y = 2;';
        expect(blanquearComentarios(src)).toContain('no es comentario');
    });

    it('un comentario sin cerrar no se come el resto en silencio… se lo come, y por eso se blanquea hasta el final', () => {
        // Si el archivo tiene un `/*` sin `*/`, es un error de sintaxis real:
        // blanquear hasta el final es la lectura correcta, no un falso negativo.
        const out = blanquearComentarios('a\n/* abierto\nb');
        expect(out.split('\n')[0]).toBe('a');
        expect(out).not.toContain('abierto');
    });
});
