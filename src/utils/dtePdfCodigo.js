// Fase 3.2 (PLAN-MEJORAS-DTE-PROVEEDORES-2026-07.md): extrae el "Código de
// Generación" (UUID v4, formato 8-4-4-4-12) impreso en la representación
// gráfica del DTE (dte_guia_tecnica.pdf pág. 7 — obligatorio en todo DTE) —
// permite emparejar un PDF huérfano o un doc "confirmado sin JSON" con su
// JSON real sin depender de un match manual a ciegas.
import * as pdfjsLib from 'pdfjs-dist';
import pdfjsWorker from 'pdfjs-dist/build/pdf.worker.min.mjs?url';

pdfjsLib.GlobalWorkerOptions.workerSrc = pdfjsWorker;

const UUID_RE = /\b[0-9A-Fa-f]{8}-[0-9A-Fa-f]{4}-[0-9A-Fa-f]{4}-[0-9A-Fa-f]{4}-[0-9A-Fa-f]{12}\b/;

// Devuelve el primer UUID encontrado en el texto del PDF (mayúsculas, mismo
// formato que codigo_generacion en BD) o null si no hay texto/no matchea —
// PDFs escaneados como imagen (sin capa de texto) no van a dar resultado.
export async function extractCodigoGeneracionFromPdf(pdfUrl) {
    const res = await fetch(pdfUrl);
    if (!res.ok) throw new Error(`No se pudo descargar el PDF (HTTP ${res.status})`);
    const buf = await res.arrayBuffer();

    const doc = await pdfjsLib.getDocument({ data: buf }).promise;
    for (let i = 1; i <= doc.numPages; i++) {
        const page = await doc.getPage(i);
        const content = await page.getTextContent();
        const text = content.items.map((it) => it.str).join(' ');
        const match = text.match(UUID_RE);
        if (match) return match[0].toUpperCase();
    }
    return null;
}
