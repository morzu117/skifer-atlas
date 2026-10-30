-- Marge nette mensuelle, méthode 1 : montant moins le coût absolu du produit.
-- Adapté de examples/24_project_analyzer/legacy_sql/06_gold_margin_v1.sql (moteur Skifer).
CREATE OR REPLACE TABLE gold.margin_v1 AS
SELECT
    o.order_month,
    SUM(o.amount - p.cost) AS net_margin
FROM silver.orders_enriched o
JOIN bronze.products_raw p ON o.product_id = p.product_id
GROUP BY o.order_month;
