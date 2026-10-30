-- Revenu net mensuel par entité, implémentation Databricks.
CREATE OR REPLACE TABLE gold.finance.revenu_net AS
WITH factures AS (
    SELECT
        entite,
        statut,
        montant_ttc - montant_taxes - avoirs AS montant_ht,
        FROM_UTC_TIMESTAMP(date_facture, 'Europe/Paris') AS date_locale
    FROM gold.finance.fact_facturation
    WHERE statut = 'validée'
)
SELECT
    DATE_TRUNC('MONTH', date_locale) AS mois_fiscal,
    entite,
    SUM(montant_ht) AS revenu_net
FROM factures
GROUP BY DATE_TRUNC('MONTH', date_locale), entite;
