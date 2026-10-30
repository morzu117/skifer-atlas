-- Marge nette mensuelle, méthode 2 : montant multiplié par (1 - taux de marge).
-- Même concept métier que marge_v1.sql, autre formule : l'écart doit ressortir au diff.
-- Adapté de examples/24_project_analyzer/legacy_sql/07_gold_margin_v2.sql (moteur Skifer),
-- sans la sous-requête scalaire, qui n'a pas d'équivalent dans le graphe.
CREATE OR REPLACE TABLE gold.margin_v2 AS
SELECT
    o.order_month,
    SUM(o.amount * (1 - p.margin_rate)) AS net_margin
FROM silver.orders_enriched o
JOIN bronze.products_raw p ON o.product_id = p.product_id
GROUP BY o.order_month;
