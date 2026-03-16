// 🔴 Imports modernos (Añadimos SheetJS para leer Excel real)
import { createClient } from "npm:@supabase/supabase-js@2";
import * as XLSX from "npm:xlsx"; 

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders });
  }

  try {
    const { branchId, username, password, fechaI, fechaF } = await req.json();

    if (!branchId || !username || !password) {
      throw new Error("Faltan credenciales o ID de sucursal.");
    }

    let startDate = fechaI;
    let endDate = fechaF;

    if (!startDate || !endDate) {
      const tzOffset = -6 * 60 * 60 * 1000; 
      const hoyCST = new Date(Date.now() + tzOffset).toISOString().split('T')[0];
      startDate = hoyCST;
      endDate = hoyCST;
    }

    // 1. LOGIN EN EL ERP
    const loginForm = new URLSearchParams();
    loginForm.append("username", username);
    loginForm.append("password", password);
    loginForm.append("m", "1");

    const loginRes = await fetch("https://clientesdte3.oss.com.sv/farma_salud/login.php", {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: loginForm.toString(),
      redirect: "manual"
    });

    const setCookieHeader = loginRes.headers.get("set-cookie");
    if (!setCookieHeader) throw new Error("Fallo al obtener cookie de sesión.");
    const sessionCookie = setCookieHeader.split(";")[0]; 

    // 2. DESCARGAR EL REPORTE (XLS BINARIO REAL)
    const dataUrl = `https://clientesdte3.oss.com.sv/farma_salud/ventas_vendedor_hora_xls.php?fini=${startDate}&ffin=${endDate}`;
    
    const dataRes = await fetch(dataUrl, {
      method: "GET",
      headers: { "Cookie": sessionCookie }
    });

    // 🚨 EL SECRETO: Lo leemos como ArrayBuffer (memoria binaria), NO como text()
    const arrayBuffer = await dataRes.arrayBuffer();
    
    console.log(`Bytes binarios recibidos: ${arrayBuffer.byteLength}`);
    if (arrayBuffer.byteLength < 1000) {
        throw new Error("El archivo devuelto es demasiado pequeño, posible error de sesión en el ERP.");
    }

    // 3. DECODIFICAR EL EXCEL CON SHEETJS
    // raw: false fuerza a que Excel nos devuelva el texto formateado (ej. "2:30 PM" y no un código de fecha raro)
    const workbook = XLSX.read(arrayBuffer, { type: 'array', raw: false, cellDates: false });
    
    // Tomamos la primera hoja del Excel
    const firstSheetName = workbook.SheetNames[0];
    const worksheet = workbook.Sheets[firstSheetName];
    
    // Lo convertimos a una matriz (arreglo de arreglos)
    const rows = XLSX.utils.sheet_to_json(worksheet, { header: 1, defval: "" });
    
    console.log(`Filas encontradas en el Excel: ${rows.length}`);

    // 4. PARSEAR Y AGRUPAR (El escáner inteligente de celdas)
    const hourlyBuckets = {};

    rows.forEach(rowCells => {
      // rowCells es un arreglo de strings, ej: ["Factura", "Cliente", "15.50", "14-03-2026", "2:30 PM"]
      if (!Array.isArray(rowCells) || rowCells.length < 3) return;

      let sale_date = "";
      let sale_hour = -1;
      let monto = 0;

      rowCells.forEach(cellValue => {
        const cellText = String(cellValue).trim();
        if (!cellText) return;

        // Buscar Fecha
        const isDate = cellText.match(/(\d{2,4})[-/](\d{2})[-/](\d{2,4})/);
        if (isDate && !sale_date) {
           if (isDate[1].length === 4) sale_date = `${isDate[1]}-${isDate[2]}-${isDate[3]}`;
           else sale_date = `${isDate[3]}-${isDate[2]}-${isDate[1]}`;
        }

        // Buscar Hora
        const isTime = cellText.match(/(\d{1,2}):(\d{2})(?::\d{2})?\s*(AM|PM)?/i);
        if (isTime && sale_hour === -1) {
            let h = parseInt(isTime[1], 10);
            if (isTime[3]) { 
               const ampm = isTime[3].toUpperCase();
               if (ampm === "PM" && h < 12) h += 12;
               if (ampm === "AM" && h === 12) h = 0;
            }
            sale_hour = h;
        }

        // Buscar Monto (Cuidado con números como códigos postales, buscamos que tengan punto decimal)
        const isMoney = cellText.match(/^\$?\s*([\d,]+\.\d{2})$/);
        if (isMoney && monto === 0) {
            monto = parseFloat(isMoney[1].replace(/,/g, ''));
        }
      });

      if (!sale_date || sale_hour === -1 || monto === 0) return;

      const key = `${sale_date}_${sale_hour}`;
      if (!hourlyBuckets[key]) {
        hourlyBuckets[key] = { sale_date, sale_hour, total_sales: 0, transaction_count: 0 };
      }
      
      hourlyBuckets[key].total_sales += monto;
      hourlyBuckets[key].transaction_count += 1;
    });

    console.log(`Cubetas de hora reales empaquetadas: ${Object.keys(hourlyBuckets).length}`);

    // 5. GUARDAR EN SUPABASE
    const supabaseClient = createClient(
      Deno.env.get('SUPABASE_URL') ?? '',
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? ''
    );

    const inserts = Object.values(hourlyBuckets).map((bucket) => ({
      branch_id: branchId,
      sale_date: bucket.sale_date,
      sale_hour: bucket.sale_hour,
      total_sales: bucket.total_sales,
      transaction_count: bucket.transaction_count
    }));

    if (inserts.length > 0) {
      const { error: sbError } = await supabaseClient
        .from('branch_hourly_sales')
        .upsert(inserts, { onConflict: 'branch_id,sale_date,sale_hour' });
      
      if (sbError) throw new Error(`Error en DB: ${sbError.message}`);
    }

    return new Response(JSON.stringify({ success: true, processed_hours: inserts.length, startDate, endDate }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });

  } catch (error) {
    console.error("🔥 ERROR EN EDGE FUNCTION:", error.message);
    return new Response(JSON.stringify({ error: error.message }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      status: 400,
    });
  }
});