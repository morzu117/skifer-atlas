-- Revenu net mensuel par entité, fonctions de date Snowflake.
CREATE OR REPLACE TABLE FINANCE.GOLD.REVENU_NET AS
WITH factures AS (
    SELECT
        entite,
        statut,
        montant_ttc - montant_taxes - avoirs AS montant_ht,
        CONVERT_TIMEZONE('UTC', 'Europe/Paris', date_facture) AS date_locale
    FROM FINANCE.GOLD.FACT_FACTURATION
    WHERE statut = 'validée'
),
jours AS (
    SELECT entite, montant_ht, date_locale::DATE AS jour
    FROM factures
)
SELECT
    DATE_TRUNC('MONTH', jour) AS mois_fiscal,
    entite,
    SUM(montant_ht) AS revenu_net
FROM jours
GROUP BY 1, 2;
