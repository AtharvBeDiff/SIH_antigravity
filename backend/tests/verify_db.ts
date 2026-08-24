import 'dotenv/config';
import { getDb, count } from '../src/db.ts';

async function main() {
  try {
    console.log('Testing Supabase connection...');
    const db = getDb();
    const { data: districts, error } = await db.from('districts').select('*');
    if (error) {
      console.error('Error fetching districts:', error.message);
      process.exit(1);
    }
    console.log(`Successfully connected! Found ${districts?.length ?? 0} districts in Supabase.`);
    
    const worksCount = await count('works');
    console.log(`Found ${worksCount} works in Supabase.`);
    
    const alertsCount = await count('alerts');
    console.log(`Found ${alertsCount} alerts in Supabase.`);
  } catch (err: any) {
    console.error('Failed to connect:', err.message);
    process.exit(1);
  }
}

main();
