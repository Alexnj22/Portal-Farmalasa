SET lock_timeout = '5s';
-- U2: «¿cuenta como venta?» se contesta con venta_valida(estado), nunca con la
-- lista a mano. Hoy dan lo mismo (0 filas distintas en 365 días); un estado
-- nuevo que nadie conoce ya no se sumaría a las baldosas de «hoy».
CREATE OR REPLACE VIEW public.branch_hourly_sales WITH (security_invoker = true) AS
 SELECT branch_id,
    fecha AS sale_date,
    (EXTRACT(hour FROM hora))::integer AS sale_hour,
    round(sum(total), 2) AS total_sales,
    count(*) AS transaction_count
   FROM sales_invoices
  WHERE public.venta_valida(estado)
  GROUP BY branch_id, fecha, (EXTRACT(hour FROM hora));
