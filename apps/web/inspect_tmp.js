const Database = require('better-sqlite3');
const db = new Database('/Users/eemnauwl/Code/pigeon/padel/cuatro/apps/web/dev.db', {readonly:true});
console.log('--- seed users ---');
console.log(db.prepare("select id,display_name,rating,confidence,verified_match_count,email from users where email like '%seed%'").all());
console.log('--- matches count ---');
console.log(db.prepare('select count(*) as n from matches').all());
console.log('--- circles ---');
console.log(db.prepare('select id,name,invite_code from circles').all());
console.log('--- tab entries count ---');
console.log(db.prepare('select count(*) as n from tab_entries').all());
console.log('--- circle_members for Tuesday Night Lot ---');
const circle = db.prepare("select id from circles where name='Tuesday Night Lot'").get();
console.log(circle);
if (circle) {
  console.log(db.prepare('select user_id, role from circle_members where circle_id=?').all(circle.id));
}
