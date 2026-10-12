/** Adds café cereza to an existing demo database (stop the API first). */
import { PG_DIR } from './config.js';
import { audit, openDb } from './db.js';
import { addCafeCereza } from './products.js';

const db = await openDb(PG_DIR);
const id = await addCafeCereza(db);
await audit(db, 'producto.alta', { name: 'Café cereza', unit: 'kg' });
await db.close();
console.log(`Café cereza listo (producto ${id})`);
