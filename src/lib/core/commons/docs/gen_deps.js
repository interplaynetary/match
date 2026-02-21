const fs = require('fs');
const path = require('path');

const dir = '/home/ruzgar/Programs/match/src/lib/core/plan';
const files = fs.readdirSync(dir).filter(f => f.endsWith('.ts'));

const deps = {};
const reverseDeps = {};

files.forEach(f => {
  deps[f] = { internal: [], external: [] };
  reverseDeps[f] = [];
});

files.forEach(f => {
  const content = fs.readFileSync(path.join(dir, f), 'utf-8');
  // Match `import ... from '...'` and `export ... from '...'`
  const importRegex = /(?:import|export)\s+(?:.*?\s+from\s+)?['"](.*?)['"]/g;
  let match;
  while ((match = importRegex.exec(content)) !== null) {
    let imported = match[1];
    if (imported.startsWith('.')) {
      if (imported.startsWith('./')) {
        let baseName = imported.replace('./', '').replace(/\.(ts|js)$/, '');
        baseName += '.ts';
        if (files.includes(baseName)) {
            if (!deps[f].internal.includes(baseName)) deps[f].internal.push(baseName);
            if (!reverseDeps[baseName]) reverseDeps[baseName] = [];
            if (!reverseDeps[baseName].includes(f)) reverseDeps[baseName].push(f);
        } else {
            if (!deps[f].external.includes(imported)) deps[f].external.push(imported);
        }
      } else {
        if (!deps[f].external.includes(imported)) deps[f].external.push(imported);
      }
    } else {
      if (!deps[f].external.includes(imported)) deps[f].external.push(imported);
    }
  }
});

let md = '# File Dependencies: `src/lib/core/plan`\n\n';

md += 'This document maps out the internal and external dependencies for each file in the `src/lib/core/plan` directory.\n\n';

files.sort().forEach(f => {
  md += `## \`${f}\`\n\n`;
  
  if (deps[f].internal.length > 0) {
    md += `**Imports (Internal):**\n`;
    deps[f].internal.sort().forEach(d => {
      md += `- \`${d}\`\n`;
    });
    md += '\n';
  } else {
    md += `**Imports (Internal):** None\n\n`;
  }
  
  if (deps[f].external.length > 0) {
    md += `**Imports (External):**\n`;
    deps[f].external.sort().forEach(d => {
      md += `- \`${d}\`\n`;
    });
    md += '\n';
  }
  
  if (reverseDeps[f] && reverseDeps[f].length > 0) {
    md += `**Imported by:**\n`;
    reverseDeps[f].sort().forEach(d => {
      md += `- \`${d}\`\n`;
    });
    md += '\n';
  } else {
    md += `**Imported by:** None\n\n`;
  }
  md += '---\n\n';
});

fs.writeFileSync(path.join(dir, 'DEPENDENCIES.md'), md);
console.log('Dependencies mapped to DEPENDENCIES.md');
