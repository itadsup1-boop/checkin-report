-- Migration v46: Clean up legacy duplicate tk_check_ins and add unique index on (user_id, date)

DELETE FROM tk_check_ins a USING tk_check_ins b
WHERE a.user_id = b.user_id
  AND a.date = b.date
  AND (
      (a.checkout_time IS NULL AND b.checkout_time IS NOT NULL)
      OR (
          ((a.checkout_time IS NULL AND b.checkout_time IS NULL) OR (a.checkout_time IS NOT NULL AND b.checkout_time IS NOT NULL))
          AND (a.created_at < b.created_at OR (a.created_at = b.created_at AND a.id < b.id))
      )
  );

CREATE UNIQUE INDEX IF NOT EXISTS idx_tk_check_ins_user_date ON tk_check_ins(user_id, date);
