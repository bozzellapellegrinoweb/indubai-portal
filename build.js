const fs = require('fs');
const path = require('path');

const SUPABASE_URL = process.env.SUPABASE_URL || '';
const SUPABASE_ANON_KEY = process.env.SUPABASE_ANON_KEY || '';

const htmlFiles = fs.readdirSync('.').filter(f => f.endsWith('.html'));
htmlFiles.forEach(file => {
  let content = fs.readFileSync(file, 'utf8');
  content = content
    .replace(/__SUPABASE_URL__/g, SUPABASE_URL)
    .replace(/__SUPABASE_ANON_KEY__/g, SUPABASE_ANON_KEY);
  fs.writeFileSync(file, content);
  console.log(`✓ Built ${file}`);
});
console.log('Build complete!');
