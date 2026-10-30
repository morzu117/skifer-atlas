# Databricks notebook source
# MAGIC %md
# MAGIC Revenu brut des commandes expédiées.

# COMMAND ----------

# MAGIC %sql
# MAGIC SELECT order_id, amount
# MAGIC FROM bronze.orders_raw
# MAGIC WHERE order_status = 'SHIPPED'

# COMMAND ----------

spark.sql("SELECT customer_id, SUM(amount) AS total FROM bronze.orders_raw GROUP BY customer_id")

# COMMAND ----------

spark.sql(f"SELECT * FROM {table}")
