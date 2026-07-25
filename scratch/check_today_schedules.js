import pool from '../packages/database/index.js';

async function check() {
  try {
    const today = '2026-07-25';
    
    console.log('=== LỊCH KHÁCH HÀNG HÔM NAY (2026-07-25) ===');
    const custRes = await pool.query(
      `SELECT id, customer_name, phone, service, sessions, session_type, revenue, today_incurred, employee_name, appointment_time, status, cancel_reason 
       FROM customer_appointments 
       WHERE appointment_time >= $1::date AND appointment_time < ($1::date + INTERVAL '1 day')
       ORDER BY appointment_time ASC`,
      [today]
    );
    console.log(JSON.stringify(custRes.rows, null, 2));

    console.log('\n=== LỊCH KHÁCH HÀNG MỚI NHẤT TRONG HỆ THỐNG ===');
    const recentCust = await pool.query(
      `SELECT id, customer_name, phone, service, sessions, session_type, revenue, today_incurred, employee_name, appointment_time, status 
       FROM customer_appointments 
       ORDER BY id DESC LIMIT 10`
    );
    console.log(JSON.stringify(recentCust.rows, null, 2));

    console.log('\n=== CA LÀM VIỆC NHÂN VIÊN HÔM NAY (2026-07-25) ===');
    const shifts = await pool.query(
      `SELECT s.id, s.date, s.shift_type, s.is_locked, e.full_name, e.employee_code 
       FROM tk_schedules s
       LEFT JOIN employees e ON s.user_id = e.id::text OR s.user_id = e.telegram_id
       WHERE s.date = $1::date`,
      [today]
    );
    console.log(JSON.stringify(shifts.rows, null, 2));

  } catch (e) {
    console.error('Error:', e);
  } finally {
    await pool.end();
  }
}

check();
