const { Client } = require('pg'); 
const c = new Client({ connectionString: process.env.DATABASE_URL }); 
c.connect().then(() => 
  c.query('SELECT full_name, need_report FROM employees')
).then(r => {
  console.log(r.rows.filter(x => x.full_name.includes('Doãn'))); 
  c.end()
});
