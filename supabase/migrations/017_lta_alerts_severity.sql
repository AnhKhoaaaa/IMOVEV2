-- dev19: weather alerts now carry a severity so the UI can intensify icon/colour.
-- 'light' | 'heavy' | NULL. Forecast alerts derive it from pop band; live-rain alerts
-- from the actual rain rate (mm/h). Other alert types leave it NULL.
alter table lta_alerts add column if not exists severity text;
