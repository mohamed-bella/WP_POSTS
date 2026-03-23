const { createClient } = require('@supabase/supabase-js');
require('dotenv').config();

async function testSupa() {
  const url = (process.env.SUPABASE_URL || '').trim();
  const key = (process.env.SUPABASE_ANON_KEY || '').trim();

  console.log('Testing Supabase Connection...');
  console.log('URL:', url);
  console.log('Key length:', key.length);
  
  if (!url || !key) {
    console.error('Missing credentials!');
    return;
  }

  const supabase = createClient(url, key);
  
  try {
    const { data, error } = await supabase.from('settings').select('*').limit(1);
    if (error) {
      console.error('Supabase Error:', error);
    } else {
      console.log('Success! Connection established.');
      console.log('Data sample:', data);
    }
  } catch (err) {
    console.error('Request Error:', err.message);
  }
}

testSupa();
