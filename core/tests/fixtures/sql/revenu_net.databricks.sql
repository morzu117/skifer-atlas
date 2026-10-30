-- Revenu net mensuel par entité, fonctions de date Databricks.
CREATE OR REPLACE TABLE gold.finance.revenu_net AS
WITH factures AS (
    SELECT
        entite,
        statut,
        montant_ttc - montant_taxes - avoirs AS montant_ht,
        FROM_UTC_TIMESTAMP(date_facture, 'Europe/Paris') AS date_locale
    FROM gold.finance.fact_facturation
    WHERE statut = 'validée'
),
jours AS (
    SELECT entite, montant_ht, TO_DATE(date_locale) AS jour
    FROM factures
)
SELECT
    DATE_TRUNC('MONTH', jour) AS mois_fiscal,
    entite,
    SUM(montant_ht) AS revenu_net
FROM jours
GROUP BY DATE_TRUNC('MONTH', jour), entite;
