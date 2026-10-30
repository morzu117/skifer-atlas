-- Chaque instruction porte des valeurs sentinelles (zqx…, 987654321) dans ses littéraux,
-- ses noms de table et de colonne : aucune ne doit apparaître dans un message de résidu.
SELECT zqx_id, ROUND(zqx_montant, 987654321) AS zqx_arrondi FROM zqx_schema.zqx_table;
SELECT zqx_id, LAG(zqx_montant) OVER (ORDER BY zqx_date) AS zqx_prec FROM zqx_schema.zqx_table;
SELECT zqx_id, CURRENT_TIMESTAMP() AS zqx_maintenant FROM zqx_schema.zqx_table WHERE zqx_code = 'ZQX_SECRET';
SELECT zqx_id, (SELECT MAX(zqx_v) FROM zqx_schema.zqx_autre WHERE zqx_k = 'ZQX_SECRET') AS zqx_max FROM zqx_schema.zqx_table;
SELECT zqx_id, zqx_x FROM zqx_schema.zqx_table LATERAL VIEW EXPLODE(zqx_tableau) zqx_e AS zqx_x;
SELECT * FROM zqx_schema.zqx_table PIVOT (SUM(zqx_v) FOR zqx_k IN ('ZQX_SECRET', 'ZQX_AUTRE'));
SELECT zqx_id FROM zqx_schema.zqx_table ORDER BY zqx_id LIMIT 987654321;
SELECT zqx_id, ZQX_FONCTION(zqx_v, 'ZQX_SECRET') AS zqx_f FROM zqx_schema.zqx_table;
SELECT a.zqx_id FROM zqx_schema.zqx_table a LEFT JOIN zqx_schema.zqx_autre b ON a.zqx_id = b.zqx_id AND b.zqx_k = 'ZQX_SECRET';
SELECT zqx_id, zqx_v * 987654321 FROM zqx_table WHERE zqx_k = 'ZQX_SECRET' ORDER BY zqx_id;
SELECT a.zqx_id, zqx_v FROM zqx_schema.zqx_table a JOIN zqx_schema.zqx_autre b ON a.zqx_id = b.zqx_id;
SELECT zqx_id, DATE_TRUNC('MONTH', zqx_date) AS zqx_mois FROM zqx_schema.zqx_table;
SELECT zqx_id FROM zqx_schema.zqx_table WHERE zqx_k = 'ZQX_SECRET' AND zqx_v >;
UPDATE zqx_schema.zqx_table SET zqx_v = 987654321 WHERE zqx_k = 'ZQX_SECRET';
