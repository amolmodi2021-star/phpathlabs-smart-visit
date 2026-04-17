UPDATE payment_transactions
SET gross_amount = -400
WHERE invoice_number = '2604160001'
  AND transaction_type = 'bill_cancellation'
  AND gross_amount = -350
  AND final_amount = -400;