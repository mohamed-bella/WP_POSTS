const fs = require('fs');
const path = require('path');

// We go two levels up from src/services to the root directory
const envPath = path.join(__dirname, '../../.env');

/**
 * Parses the .env file and returns an object of key/value pairs
 * @returns {Object} JSON payload of all env variables
 */
function getEnv() {
  if (!fs.existsSync(envPath)) return {};
  
  const content = fs.readFileSync(envPath, 'utf8');
  const lines = content.split('\n');
  const env = {};
  
  for (const line of lines) {
    // Skip comments and empty lines
    if (line.trim().startsWith('#') || !line.includes('=')) continue;
    
    // Split on first equals
    const firstEq = line.indexOf('=');
    const key = line.substring(0, firstEq).trim();
    let value = line.substring(firstEq + 1).trim();
    
    // Strip surrounding quotes if present
    if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
      value = value.substring(1, value.length - 1);
    }
    
    env[key] = value;
  }
  
  return env;
}

/**
 * Updates specific keys in the .env file while preserving comments and styling
 * @param {Object} updates JSON payload of { KEY: VALUE } pairs to update or add
 */
function updateEnv(updates) {
  if (!fs.existsSync(envPath)) fs.writeFileSync(envPath, '');
  
  const content = fs.readFileSync(envPath, 'utf8');
  const lines = content.split('\n');
  const updatedKeys = new Set();

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    if (line.trim().startsWith('#') || !line.includes('=')) continue;
    
    const key = line.split('=')[0].trim();
    
    // If this key is in the update payload, replace the line entirely
    if (updates.hasOwnProperty(key)) {
      // SECURITY FIX: If the frontend sent masked (••••••••) password string back, ignore it.
      if (typeof updates[key] === 'string' && updates[key].includes('••••••••')) {
        updatedKeys.add(key);
        continue;
      }
      
      // Ensure complex values (like JSON) are stringified if passed as objects, though .env expects strings
      let newVal = updates[key];
      if (typeof newVal === 'object') newVal = JSON.stringify(newVal);
      
      // If the value contains spaces or complex characters, wrap it in single quotes
      // Google service JSON specifically needs single quotes around the raw JSON
      if (typeof newVal === 'string' && (newVal.includes(' ') || newVal.startsWith('{'))) {
         lines[i] = `${key}='${newVal}'`;
      } else {
         lines[i] = `${key}=${newVal}`;
      }
      
      updatedKeys.add(key);
      
      // Live mutate process.env so it takes effect immediately in the runtime
      process.env[key] = updates[key];
    }
  }

  // Traverse the updates object and append any entirely new keys
  let needsTrailingNewline = false;
  if (lines.length > 0 && lines[lines.length - 1] !== '') {
    needsTrailingNewline = true;
  }
  
  for (const [key, value] of Object.entries(updates)) {
    if (!updatedKeys.has(key)) {
      // SECURITY FIX: Ignore masked strings
      if (typeof value === 'string' && value.includes('••••••••')) continue;

      if (needsTrailingNewline) {
        lines.push('');
        needsTrailingNewline = false;
      }
      let newVal = value;
      if (typeof newVal === 'object') newVal = JSON.stringify(newVal);
      if (typeof newVal === 'string' && (newVal.includes(' ') || newVal.startsWith('{'))) {
         lines.push(`${key}='${newVal}'`);
      } else {
         lines.push(`${key}=${newVal}`);
      }
      // Live mutate process.env
      process.env[key] = newVal;
    }
  }

  // Write the file safely
  fs.writeFileSync(envPath, lines.join('\n'));
  return true;
}

module.exports = {
  getEnv,
  updateEnv
};
