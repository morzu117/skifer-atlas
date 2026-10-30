-- Revenu net mensuel par entité, implémentation Snowflake.
-- Fonctions de date propres à Snowflake (CONVERT_TIMEZONE) ; le filtre retient aussi les
-- factures émises non encore validées : c'est l'écart critique que le diff doit montrer.
CREATE OR REPLACE TABLE FINANCE.GOLD.REVENU_NET AS
WITH factures AS (
    SELECT
        entite,
        statut,
        montant_ttc - montant_taxes - avoirs AS montant_ht,
        CONVERT_TIMEZONE('UTC', 'Europe/Paris', date_facture) AS date_locale
    FROM FINANCE.GOLD.FACT_FACTURATION
    WHERE statut IN ('validée', 'émise')
)
SELECT
    DATE_TRUNC('MONTH', date_locale) AS mois_fiscal,
    entite,
    SUM(montant_ht) AS revenu_net
FROM factures
GROUP BY 1, 2;
