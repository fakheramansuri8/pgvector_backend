import { Sequelize } from 'sequelize';
import * as dotenv from 'dotenv';

dotenv.config();

async function enableFuzzystrmatch() {
  const databaseUrl =
    process.env.DATABASE_URI ||
    'postgres://postgres:postgres@172.17.172.151:5432/pgvector_db';

  console.log('Connecting to database...');
  const sequelize = new Sequelize(databaseUrl, {
    logging: false,
  });

  try {
    await sequelize.authenticate();
    console.log('Connected to database successfully.');

    // Enable fuzzystrmatch extension
    console.log('Enabling fuzzystrmatch extension...');
    await sequelize.query('CREATE EXTENSION IF NOT EXISTS fuzzystrmatch;');
    console.log('✅ fuzzystrmatch extension enabled!');

    // Test the extension
    console.log('\nTesting phonetic functions...');
    
    // Test Soundex
    const [soundexResults] = await sequelize.query(`
      SELECT 
        'Gaurav' as name, soundex('Gaurav') as soundex_code
      UNION ALL
      SELECT 'Gowrav', soundex('Gowrav')
      UNION ALL
      SELECT 'Saurav', soundex('Saurav')
      UNION ALL
      SELECT 'Sourav', soundex('Sourav');
    `);
    console.log('\nSoundex codes:');
    console.table(soundexResults);

    // Test Metaphone
    const [metaphoneResults] = await sequelize.query(`
      SELECT 
        'Gaurav' as name, metaphone('Gaurav', 10) as metaphone_code
      UNION ALL
      SELECT 'Gowrav', metaphone('Gowrav', 10)
      UNION ALL
      SELECT 'Saurav', metaphone('Saurav', 10)
      UNION ALL
      SELECT 'Sourav', metaphone('Sourav', 10);
    `);
    console.log('\nMetaphone codes:');
    console.table(metaphoneResults);

    // Test Double Metaphone
    const [dmetaphoneResults] = await sequelize.query(`
      SELECT 
        'Gaurav' as name, dmetaphone('Gaurav') as dmetaphone_code
      UNION ALL
      SELECT 'Gowrav', dmetaphone('Gowrav')
      UNION ALL
      SELECT 'Saurav', dmetaphone('Saurav')
      UNION ALL
      SELECT 'Sourav', dmetaphone('Sourav');
    `);
    console.log('\nDouble Metaphone codes:');
    console.table(dmetaphoneResults);

    // Test Levenshtein
    const [levenshteinResults] = await sequelize.query(`
      SELECT 
        'Gowrav' as query,
        'Gaurav' as candidate,
        levenshtein('Gowrav', 'Gaurav') as edit_distance,
        soundex('Gowrav') = soundex('Gaurav') as soundex_match
      UNION ALL
      SELECT 
        'Gowrav',
        'Saurav',
        levenshtein('Gowrav', 'Saurav'),
        soundex('Gowrav') = soundex('Saurav');
    `);
    console.log('\nComparison Gowrav vs Gaurav vs Saurav:');
    console.table(levenshteinResults);

    console.log('\n✅ All phonetic functions are working correctly!');
  } catch (error) {
    console.error('❌ Error:', error);
    process.exit(1);
  } finally {
    await sequelize.close();
  }
}

enableFuzzystrmatch();

