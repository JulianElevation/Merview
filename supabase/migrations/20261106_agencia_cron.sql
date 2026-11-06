-- Toma la foto del gasto cada 30 minutos, para la alerta de 8 horas.
select cron.schedule('meta-foto', '*/30 * * * *', $$select public.meta_foto_tomar()$$);
select public.meta_foto_tomar();
