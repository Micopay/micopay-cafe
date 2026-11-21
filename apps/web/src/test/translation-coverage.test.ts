import { parse } from '@babel/parser';
import traverse from '@babel/traverse';
import { glob } from 'glob';
import { readFile } from 'fs/promises';
import { EN } from '../i18n';

describe('Translation coverage', () => {
  it('every literal t() key has an entry in the EN dictionary', async () => {
    const files = await glob('src/**/*.{ts,tsx}', { cwd: process.cwd() });
    const missingKeys: Array<{ file: string; key: string; line: number }> = [];

    for (const file of files) {
      const content = await readFile(file, 'utf-8');
      let ast;

      try {
        ast = parse(content, {
          sourceType: 'module',
          plugins: ['jsx', 'typescript'],
        });
      } catch (e) {
        // Skip files that can't be parsed (e.g., test files with special syntax)
        continue;
      }

      traverse(ast, {
        CallExpression(path) {
          const callee = path.node.callee;
          // Check if this is a t() call
          if (callee.type === 'Identifier' && callee.name === 't') {
            const args = path.node.arguments;
            if (args.length > 0) {
              const firstArg = args[0];
              let key: string | null = null;

              // Extract literal string (single or double quotes)
              if (firstArg.type === 'StringLiteral') {
                key = firstArg.value;
              }
              // Extract static template literal (no expressions)
              else if (firstArg.type === 'TemplateLiteral' && firstArg.expressions.length === 0) {
                key = firstArg.quasis[0].value.raw;
              }

              if (key !== null && !(key in EN)) {
                missingKeys.push({
                  file,
                  key,
                  line: path.node.loc?.start.line ?? 0,
                });
              }
            }
          }
        },
      });
    }

    if (missingKeys.length > 0) {
      const message = missingKeys
        .map(({ file, key, line }) => `  ${file}:${line} - missing key: "${key}"`)
        .join('\n');
      expect.fail(`Found ${missingKeys.length} t() keys without EN translations:\n${message}`);
    }
  });
});
