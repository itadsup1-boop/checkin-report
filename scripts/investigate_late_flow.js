import 'dotenv/config';
import pool from '../packages/database/index.js';

async function investigate() {
  try {
    const targetDate = '2026-09-30';

    console.log('=== 1. TK LEAVE REQUESTS TODAY ===');
    const leaves = await pool.query(`
      SELECT lr.*, e.full_name, tg.group_name
      FROM tk_leave_requests lr
      LEFT JOIN employees e ON lr.user_id = e.id
      LEFT JOIN telegram_groups tg ON lr.group_id = tg.id OR lr.group_id = tg.telegram_group_id
      WHERE lr.date = $1 OR lr.created_at::date = $1
      ORDER BY lr.created_at DESC
    `, [targetDate]);
    console.table(leaves.rows);

    console.log('=== 2. ALL CHECK-INS TODAY ===');
    const checkins = await pool.query(`
      SELECT c.*, e.full_name, tg.group_name
      FROM tk_check_ins c
      LEFT JOIN employees e ON c.user_id = e.id
      LEFT JOIN telegram_groups tg ON c.group_id = tg.id
      WHERE c.date = $1 OR c.created_at::date = $1
      ORDER BY c.check_in_time ASC
    `, [targetDate]);
    console.table(checkins.rows);

    console.log('=== 3. ATTENDANCE STATUS TODAY ===');
    const att = await pool.query(`
      SELECT ds.*, e.full_name
      FROM tk_attendance_daily_status ds
      LEFT JOIN employees e ON ds.user_id = e.id
      WHERE ds.date = $1
    `, [targetDate]);
    console.table(att.rows);

    console.log('=== 4. PENALTIES TODAY ===');
    const pen = await pool.query(`
      SELECT p.*, e.full_name
      FROM tk_penalties p
      LEFT JOIN employees e ON p.user_id = e.id
      WHERE p.date = $1 OR p.created_at::date = $1
    `, [targetDate]);
    console.table(pen.rows);

  } catch (err) {
    console.error(err);
  } finally {
    await pool.end();
  }
}

investigate();
