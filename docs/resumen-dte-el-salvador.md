# Sistema de Ventas Farmacia — Resumen DTE El Salvador

**Fecha:** Junio 2026  
**Preparado para:** Portal Farmalasa

---

## 1. ¿Qué es el DTE?

Un **Documento Tributario Electrónico (DTE)** es la versión digital de los documentos fiscales tradicionales. Se genera en formato JSON, se firma digitalmente y se transmite en tiempo real al Ministerio de Hacienda (DGII).

**Base legal:** Decreto Legislativo N.º 487 (agosto 2022), que reformó el Código Tributario.  
**Organismo rector:** Dirección General de Impuestos Internos (DGII).  
**Portal oficial:** [admin.factura.gob.sv](https://admin.factura.gob.sv)

---

## 2. Tipos de DTE — Los que usa la farmacia

De los 11 tipos existentes, la farmacia opera principalmente con:

| Código | Documento | Uso |
|--------|-----------|-----|
| **01** | Factura Electrónica (FE) | Venta a consumidor final — la mayoría de ventas |
| **03** | Comprobante de Crédito Fiscal (CCF) | Venta a empresas que acreditan IVA |
| **05** | Nota de Crédito | Devoluciones y anulaciones parciales |
| **06** | Nota de Débito | Cargos adicionales posteriores |

---

## 3. Volumen de operaciones (Mayo 2026)

| Sucursal | Ventas/mes | Ventas/día aprox. | Monto mensual |
|----------|-----------|-------------------|---------------|
| **Total 6 sucursales** | **45,396** | **~1,464** | **$470,479** |
| Sucursal 4 | 10,552 | ~340 | $107,484 |
| Sucursal 28 | 9,100 | ~294 | $84,806 |
| Sucursal 25 | 7,916 | ~255 | $83,507 |
| Sucursal 2 | 7,498 | ~242 | $76,868 |
| Sucursal 27 | 7,410 | ~239 | $87,691 |
| Sucursal 29 | 2,920 | ~94 | $30,119 |

**Conclusión de volumen:** Con ~1,464 DTEs/día, un proveedor externo a $0.05/DTE costaría ~$2,270/mes (~$27,000/año). Motor propio elimina ese costo por completo.

---

## 4. Motor DTE propio vs. proveedor externo

| Aspecto | Proveedor externo (actual ERP) | Motor propio (nuevo portal) |
|---------|-------------------------------|----------------------------|
| Costo por DTE | $0.05–$0.10 | $0 |
| Costo mensual estimado | ~$2,270+ | Solo infraestructura Supabase |
| Dependencia | Alta (si el proveedor falla, tú fallas) | Ninguna |
| Personalización | Limitada | Total |
| Reportes DTE | Los que el proveedor ofrece | Los que tú diseñes |
| Velocidad | Latencia del tercero | La que tú optimices |
| Control del certificado | Del proveedor | Propio |

**Decisión: Motor propio.** Al volumen de la farmacia es la única opción económicamente racional.

---

## 5. Cómo funciona técnicamente el motor propio

```
Venta completada en el POS
        ↓
Generar JSON del DTE (esquema oficial DGII)
        ↓
Firmar con certificado de la farmacia (JWS) — vía Edge Function segura
        ↓
        ┌─────────────────────┐
        │ ¿Hay internet?      │
        └─────────────────────┘
        Sí ↓                No ↓
Transmitir a API DGII    Guardar como DTE Contingencia
        ↓                   (IndexedDB local)
Recibir Sello            Transmitir en lote al reconectar
de Recepción                    ↓
        ↓               Sello de Recepción en diferido
DTE válido → imprimir/enviar al cliente
```

**Nota importante:** La firma digital nunca vive en el browser. El certificado se almacena cifrado en variables de entorno de Supabase Edge Functions. El POS envía los datos → la Edge Function firma y transmite → devuelve el sello.

---

## 6. ¿El sistema necesita registrarse o legalizarse?

**No. El software como tal no se registra, no se certifica ni se legaliza.**

El Salvador **no tiene la figura del PAC** (Proveedor Autorizado Certificado) como México. No existe un registro de proveedores de software ante Hacienda.

**Lo que sí existe es la acreditación del CONTRIBUYENTE** (la farmacia), no del sistema. Y la farmacia ya está acreditada porque hoy emite DTEs desde el ERP.

---

## 7. ¿Los códigos de sucursal y caja cambian al cambiar de software?

**No.** Los códigos S001 (sucursal) y P001 (punto de venta) están asignados al **contribuyente/negocio** en el RUC (Formulario F-210), no al software.

Formato del número de control (desde octubre 2025):
```
DTE-01-S001P001-000000000000001
       ^^^^↑^^^
       S001 = código sucursal (asignado por Hacienda, pertenece a la farmacia)
            P001 = código caja/POS (asignado por Hacienda, pertenece a la farmacia)
```

Al cambiar de ERP al nuevo portal, los mismos códigos se usan en el nuevo sistema. No hay reregistro en Hacienda por cambio de software.

---

## 8. Proceso de transición (ERP → Portal propio)

Como la farmacia ya es emisor acreditado y los códigos ya están registrados, el proceso se simplifica a:

```
1. Solicitar acceso al ambiente de pruebas de la DGII para el nuevo sistema
        ↓
2. Desarrollar el motor DTE en el portal (JSON + firma + transmisión)
        ↓
3. Pasar las pruebas: FE-01, CCF-03, NC-05, eventos de contingencia
   (hasta 60 días disponibles, pero siendo ya emisores activos es más ágil)
        ↓
4. DGII autoriza el nuevo sistema de transmisión
        ↓
5. Obtener/migrar certificado de firma digital para el nuevo sistema
        ↓
6. Migrar sucursal por sucursal (ERP en paralelo hasta confirmar estabilidad)
        ↓
7. ERP queda en desuso
```

**Resumen:** Es básicamente "oigan, vamos a usar un sistema distinto — aquí están las pruebas de que funciona" y listo. Lo más complejo es el desarrollo técnico del motor, no los trámites legales.

---

## 9. Requisitos técnicos del sistema (lo que la DGII exige)

- DTEs en formato **JSON** según esquemas oficiales de la DGII
- Firma digital **JWS** con certificado emitido/autorizado por DGII
- Transmisión en tiempo real a la **API oficial** (factura.gob.sv)
- Manejo de **DTE de Contingencia** cuando no hay internet
- Almacenamiento de documentos por **10 años** (obligación legal)
- Uso de **catálogos actualizados** (desde octubre 2025 los catálogos viejos son rechazados)
- Códigos de establecimiento y POS registrados vía **Formulario F-210**

---

## 10. Pasos recomendados antes de iniciar el desarrollo

1. **Confirmar con el contador/asesor fiscal** el estado de la acreditación actual y qué códigos S/P están registrados en el RUC
2. **Conseguir la base de datos del ERP** para mapear todos los tipos de DTE que se emiten, volúmenes por tipo, y casos especiales
3. **Terminar los módulos actuales del portal** antes de iniciar el módulo de ventas
4. **Definir el diseño completo** de módulos, tablas y flujos antes de escribir código
5. Cuando sea el momento, solicitar acceso al **ambiente de pruebas de la DGII**

---

## 11. Módulos del sistema de ventas (visión general)

| Módulo | Descripción |
|--------|-------------|
| **POS** | Interfaz de venta: búsqueda, carrito, cobro, impresión |
| **Caja & Turnos** | Apertura/cierre, arqueo, historial por turno y cajero |
| **Motor DTE** | Generación, firma, transmisión, contingencia, reimpresión |
| **Clientes** | Gestión para CCF, historial de compras, crédito |
| **Inventario** | Descuento de stock en tiempo real al vender |
| **Reportes** | Ventas por hora/producto/sucursal, cierres diarios |
| **Farmacia** | Lotes, vencimientos, recetas (controlados) |

---

*Documento preparado en base a investigación de fuentes oficiales y públicas. Para confirmación de detalles específicos del proceso de acreditación, consultar directamente con DGII o asesor fiscal.*

**Fuentes consultadas:**
- [admin.factura.gob.sv](https://admin.factura.gob.sv) — Portal oficial DGII
- [Consortium Legal — Plataformas de transmisión DTE](https://consortiumlegal.com/2023/10/03/plataformas-de-transmision-como-medio-para-facturar-electronicamente-en-el-salvador/)
- [Contaportable — Nuevo requisito control number](https://www.contaportable.com/nuevo-requisito-para-la-facturacion-electronica-si-no-lo-cumples-no-podras-facturar/)
- [Contaportable — Normativa DTE 2.0](https://www.contaportable.com/normativa-facturacion-electronica-2-0-el-salvador/)
- [Ministerio de Hacienda — Decreto 487](https://www.mh.gob.sv/reformas-al-codigo-tributario-relativas-a-la-facturacion-electronica-documentos-tributarios-electronicos-dte/)
