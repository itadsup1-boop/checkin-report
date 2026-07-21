import pool from './index.js';

async function run() {
    try {
        await pool.query('ALTER TABLE image_fingerprints ADD COLUMN IF NOT EXISTS external_image_id INTEGER;');
        console.log('Successfully added column external_image_id to image_fingerprints.');
    } catch (e) {
        console.error('Migration failed:', e);
    } finally {
        await pool.end();
    }
}
run();
