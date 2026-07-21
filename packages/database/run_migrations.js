import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import pool from './index.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

async function runMigrations() {
    try {
        const schemaPath = path.join(__dirname, 'schema_timekeep.sql');
        const sql = fs.readFileSync(schemaPath, 'utf-8');
        
        console.log('Running schema_timekeep.sql...');
        await pool.query(sql);
        console.log('Migration successful: All tk_ tables created.');
        
    } catch (error) {
        console.error('Migration failed:', error);
    } finally {
        await pool.end();
    }
}

runMigrations();
