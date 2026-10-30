-- Revenu net, Nordis France, implémentation Databricks (le « comment »).
SELECT
    DATE_TRUNC('MONTH', d.date_comptable) AS mois_fiscal,
    f.entite,
    SUM(f.montant_ttc / 1.2 - f.avoirs) AS revenu_net
FROM gold.finance.fact_facturation f
JOIN gold.finance.dim_date d ON f.date_facture = d.date_jour
WHERE f.statut = 'validée'
GROUP BY DATE_TRUNC('MONTH', d.date_comptable), f.entite;
